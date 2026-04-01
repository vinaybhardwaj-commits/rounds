// ============================================
// LeadSquared → Rounds Sync Engine
// Orchestrates pulling leads from LSQ and
// upserting them as patient_threads in Rounds.
// ============================================

import { query, queryOne } from './db';
import {
  getLeadsByStage,
  getLeadById,
  getAllLeadActivities,
  normalizeLead,
  extractClinicalInfoFromActivities,
  setCurrentSyncRunId,
  type LSQLeadRaw,
  type NormalizedLead,
} from './leadsquared';
import { createPatientChannel, sendSystemMessage } from './getstream';
import { postPatientActivity } from './patient-activity';

// ============================================
// TYPES
// ============================================

export interface SyncResult {
  syncType: 'webhook' | 'poll' | 'manual';
  triggerStage: string | null;
  leadsFound: number;
  leadsCreated: number;
  leadsUpdated: number;
  leadsSkipped: number;
  errors: string[];
  durationMs: number;
}

// ============================================
// CORE SYNC LOGIC
// ============================================

/**
 * Upsert a single lead into patient_threads.
 * If the lead already exists (by lsq_lead_id), update it.
 * If it's new, create a new patient_thread.
 *
 * Returns: 'created' | 'updated' | 'skipped'
 */
export async function upsertLeadAsPatient(
  normalized: NormalizedLead,
  enrichedData?: {
    doctorName?: string | null;
    clinic?: string | null;
    appointmentDate?: string | null;
    hospitalLocation?: string | null;
    surgeryRecommended?: boolean;
    remarks?: string | null;
  }
): Promise<{ action: 'created' | 'updated' | 'skipped'; id: string | null }> {
  // Check if this lead already exists in Rounds
  const existing = await queryOne<{ id: string; lsq_lead_stage: string }>(
    `SELECT id, lsq_lead_stage FROM patient_threads WHERE lsq_lead_id = $1`,
    [normalized.lsqLeadId]
  );

  // Merge enriched data from activities
  const doctorName = enrichedData?.doctorName || normalized.doctorName;
  const appointmentDate = enrichedData?.appointmentDate || normalized.appointmentDate;
  const hospitalLocation = enrichedData?.hospitalLocation || normalized.hospitalLocation;

  if (existing) {
    // Update existing record
    await query(
      `UPDATE patient_threads SET
        patient_name = COALESCE($2, patient_name),
        phone = COALESCE($3, phone),
        whatsapp_number = COALESCE($4, whatsapp_number),
        email = COALESCE($5, email),
        gender = COALESCE($6, gender),
        age = COALESCE($7, age),
        city = COALESCE($8, city),
        state = COALESCE($9, state),
        address = COALESCE($10, address),
        ailment = COALESCE($11, ailment),
        uhid = COALESCE($12, uhid),
        ip_number = COALESCE($13, ip_number),
        doctor_name = COALESCE($14, doctor_name),
        appointment_date = COALESCE($15::timestamptz, appointment_date),
        hospital_location = COALESCE($16, hospital_location),
        surgery_order_value = COALESCE($17, surgery_order_value),
        lsq_lead_stage = $18,
        lsq_owner_name = COALESCE($19, lsq_owner_name),
        lsq_owner_email = COALESCE($20, lsq_owner_email),
        lsq_last_synced_at = NOW(),
        current_stage = CASE
          WHEN current_stage = 'opd' AND $18 = 'IPD WIN' THEN 'pre_admission'
          ELSE current_stage
        END,
        primary_diagnosis = COALESCE($21, primary_diagnosis),
        planned_procedure = COALESCE($22, planned_procedure),
        utm_source = COALESCE($23, utm_source),
        utm_campaign = COALESCE($24, utm_campaign),
        utm_medium = COALESCE($25, utm_medium),
        signup_url = COALESCE($26, signup_url),
        financial_category = COALESCE($27, financial_category)
      WHERE id = $1`,
      [
        existing.id,
        normalized.patientName,
        normalized.phone,
        normalized.whatsappNumber,
        normalized.email,
        normalized.gender,
        normalized.age,
        normalized.city,
        normalized.state,
        normalized.address,
        normalized.ailment,
        normalized.uhid,
        normalized.ipNumber,
        doctorName,
        appointmentDate,
        hospitalLocation,
        normalized.surgeryOrderValue,
        normalized.lsqLeadStage,
        normalized.ownerName,
        normalized.ownerEmail,
        normalized.primaryDiagnosis,
        normalized.plannedProcedure,
        normalized.utmSource,
        normalized.utmCampaign,
        normalized.utmMedium,
        normalized.signupUrl,
        normalized.surgeryOrderValue ? 'cash' : null, // Default financial category
      ]
    );
    return { action: 'updated', id: existing.id };
  }

  // Create new patient_thread
  const insertResult = await queryOne<{ id: string }>(
    `INSERT INTO patient_threads (
      patient_name, lsq_lead_id, lsq_prospect_auto_id,
      phone, whatsapp_number, email,
      gender, age, date_of_birth,
      city, state, address, zip,
      ailment, uhid, ip_number,
      doctor_name, appointment_date, hospital_location,
      surgery_order_value, financial_category,
      current_stage, lead_source, lsq_lead_stage,
      lsq_owner_name, lsq_owner_email, lsq_created_on,
      lsq_last_synced_at,
      primary_diagnosis, planned_procedure,
      utm_source, utm_campaign, utm_medium, signup_url
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9::date,
      $10, $11, $12, $13,
      $14, $15, $16,
      $17, $18::timestamptz, $19,
      $20, $21,
      $22, $23, $24,
      $25, $26, $27::timestamptz,
      NOW(),
      $28, $29,
      $30, $31, $32, $33
    ) RETURNING id`,
    [
      normalized.patientName,
      normalized.lsqLeadId,
      normalized.lsqProspectAutoId,
      normalized.phone,
      normalized.whatsappNumber,
      normalized.email,
      normalized.gender,
      normalized.age,
      normalized.dateOfBirth,
      normalized.city,
      normalized.state,
      normalized.address,
      normalized.zip,
      normalized.ailment,
      normalized.uhid,
      normalized.ipNumber,
      doctorName,
      appointmentDate,
      hospitalLocation,
      normalized.surgeryOrderValue,
      normalized.surgeryOrderValue ? 'cash' : null,
      normalized.roundsStage,       // 'opd' for OPD WIN, 'pre_admission' for IPD WIN
      normalized.leadSource,        // e.g., 'HOSPITAL'
      normalized.lsqLeadStage,      // e.g., 'OPD WIN', 'IPD WIN'
      normalized.ownerName,
      normalized.ownerEmail,
      normalized.lsqCreatedOn,
      normalized.primaryDiagnosis,
      normalized.plannedProcedure,
      normalized.utmSource,
      normalized.utmCampaign,
      normalized.utmMedium,
      normalized.signupUrl,
    ]
  );

  const newId = insertResult?.id || null;

  // Auto-create GetStream channel for the new patient
  if (newId) {
    try {
      const channelId = await createPatientChannel({
        patientThreadId: newId,
        patientName: normalized.patientName,
        uhid: normalized.uhid || null,
        currentStage: normalized.roundsStage,
        departmentId: null,
        createdById: 'rounds-system', // system-created, no human creator
        memberIds: [],                // members added on login via autoJoinDefaultChannels
      });

      // Store the channel ID on the patient thread
      await query(
        `UPDATE patient_threads SET getstream_channel_id = $1 WHERE id = $2`,
        [channelId, newId]
      );

      // Post welcome message
      await sendSystemMessage(
        'patient-thread',
        channelId,
        `🔗 Patient imported from LeadSquared: ${normalized.patientName}${normalized.uhid ? ` (UHID: ${normalized.uhid})` : ''}. Stage: ${normalized.roundsStage.replace(/_/g, ' ').toUpperCase()}.`
      );
    } catch (chErr) {
      // Channel creation failure is non-fatal — DB record is created
      console.error(`[LSQ Sync] Failed to create GetStream channel for ${newId}:`, chErr);
    }
  }

  return { action: 'created', id: newId };
}

/**
 * Enrich a lead with activity history data.
 * Fetches activities from LSQ and extracts clinical info.
 */
export async function enrichLeadFromActivities(
  leadId: string
): Promise<{
  doctorName: string | null;
  clinic: string | null;
  appointmentDate: string | null;
  hospitalLocation: string | null;
  surgeryRecommended: boolean;
  remarks: string | null;
}> {
  try {
    const activities = await getAllLeadActivities(leadId);
    return extractClinicalInfoFromActivities(activities);
  } catch (error) {
    console.error(`[LSQ Sync] Failed to enrich lead ${leadId}:`, error);
    return {
      doctorName: null,
      clinic: null,
      appointmentDate: null,
      hospitalLocation: null,
      surgeryRecommended: false,
      remarks: null,
    };
  }
}

// ============================================
// BATCH SYNC
// ============================================

/**
 * Sync all leads from a specific stage.
 * Used by both polling and manual sync.
 */
export async function syncLeadsByStage(
  stage: string,
  syncType: 'poll' | 'manual' = 'poll',
  options?: {
    enrichFromActivities?: boolean;
    modifiedAfter?: string;
  }
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    syncType,
    triggerStage: stage,
    leadsFound: 0,
    leadsCreated: 0,
    leadsUpdated: 0,
    leadsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  // Create sync run record at the START so API calls can reference it
  const syncRunId = await startSyncRun(syncType, stage);

  try {
    // Fetch leads from LSQ
    console.log(`[LSQ Sync] Fetching ${stage} leads...`);
    const rawLeads = await getLeadsByStage(stage);
    result.leadsFound = rawLeads.length;
    console.log(`[LSQ Sync] Found ${rawLeads.length} ${stage} leads`);

    // Filter by modified date if specified
    let leadsToSync = rawLeads;
    if (options?.modifiedAfter) {
      const afterDate = new Date(options.modifiedAfter);
      leadsToSync = rawLeads.filter(lead => {
        const modifiedOn = lead.ModifiedOn;
        if (!modifiedOn) return true; // Include leads without a modified date
        return new Date(modifiedOn) > afterDate;
      });
      console.log(`[LSQ Sync] ${leadsToSync.length} leads modified after ${options.modifiedAfter}`);
    }

    // Process each lead
    for (const rawLead of leadsToSync) {
      try {
        const normalized = normalizeLead(rawLead);

        // Optionally enrich from activity history
        let enrichedData;
        if (options?.enrichFromActivities !== false) {
          enrichedData = await enrichLeadFromActivities(rawLead.ProspectID);
        }

        const { action, id: newPatientId } = await upsertLeadAsPatient(normalized, enrichedData);

        switch (action) {
          case 'created':
            result.leadsCreated++;
            // Look up channel ID that was just created in upsertLeadAsPatient
            let newChannelId: string | null = null;
            if (newPatientId) {
              try {
                const chRow = await queryOne<{ getstream_channel_id: string }>(
                  `SELECT getstream_channel_id FROM patient_threads WHERE id = $1`,
                  [newPatientId]
                );
                newChannelId = chRow?.getstream_channel_id || null;
              } catch { /* non-fatal */ }
            }
            // Post activity for newly imported patients
            postPatientActivity({
              type: 'patient_imported',
              patientThreadId: newPatientId || '',
              patientName: normalized.patientName,
              patientChannelId: newChannelId, // channel now exists from upsertLeadAsPatient
              actor: { profileId: 'rounds-system', name: 'LeadSquared Sync' },
              data: {
                stageLabel: normalized.roundsStage === 'pre_admission' ? 'Pre-Admission' : 'OPD',
                ailment: normalized.ailment,
                lsqLeadId: normalized.lsqLeadId,
              },
            }).catch(() => { /* non-blocking */ });
            break;
          case 'updated': result.leadsUpdated++; break;
          case 'skipped': result.leadsSkipped++; break;
        }
      } catch (error) {
        const errorMsg = `Failed to sync lead ${rawLead.ProspectAutoId} (${rawLead.FirstName} ${rawLead.LastName}): ${error}`;
        console.error(`[LSQ Sync] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `Batch sync failed for stage ${stage}: ${error}`;
    console.error(`[LSQ Sync] ${errorMsg}`);
    result.errors.push(errorMsg);
  }

  result.durationMs = Date.now() - startTime;

  // Update sync run record with final results
  await completeSyncRun(syncRunId, result);

  console.log(`[LSQ Sync] Complete: ${result.leadsCreated} created, ${result.leadsUpdated} updated, ${result.leadsSkipped} skipped, ${result.errors.length} errors (${result.durationMs}ms)`);

  return result;
}

/**
 * Sync a single lead by its ProspectID.
 * Used by the webhook handler.
 */
export async function syncSingleLead(
  prospectId: string,
  syncType: 'webhook' | 'manual' = 'webhook'
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    syncType,
    triggerStage: null,
    leadsFound: 1,
    leadsCreated: 0,
    leadsUpdated: 0,
    leadsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  // Create sync run record at the START
  const syncRunId = await startSyncRun(syncType, null);

  try {
    const rawLead = await getLeadById(prospectId);
    if (!rawLead) {
      result.errors.push(`Lead not found: ${prospectId}`);
      result.leadsSkipped = 1;
      result.durationMs = Date.now() - startTime;
      await completeSyncRun(syncRunId, result);
      return result;
    }

    result.triggerStage = rawLead.ProspectStage;

    // Only sync OPD WIN and IPD WIN leads
    const stage = rawLead.ProspectStage?.trim();
    if (stage !== 'OPD WIN' && stage !== 'IPD WIN') {
      result.leadsSkipped = 1;
      result.durationMs = Date.now() - startTime;
      await completeSyncRun(syncRunId, result);
      return result;
    }

    const normalized = normalizeLead(rawLead);
    const enrichedData = await enrichLeadFromActivities(rawLead.ProspectID);
    const { action, id: newPatientId } = await upsertLeadAsPatient(normalized, enrichedData);

    switch (action) {
      case 'created':
        result.leadsCreated = 1;
        // Look up channel ID that was just created
        let singleChannelId: string | null = null;
        if (newPatientId) {
          try {
            const chRow = await queryOne<{ getstream_channel_id: string }>(
              `SELECT getstream_channel_id FROM patient_threads WHERE id = $1`,
              [newPatientId]
            );
            singleChannelId = chRow?.getstream_channel_id || null;
          } catch { /* non-fatal */ }
        }
        postPatientActivity({
          type: 'patient_imported',
          patientThreadId: newPatientId || '',
          patientName: normalized.patientName,
          patientChannelId: singleChannelId,
          actor: { profileId: 'rounds-system', name: 'LeadSquared Sync' },
          data: {
            stageLabel: normalized.roundsStage === 'pre_admission' ? 'Pre-Admission' : 'OPD',
            ailment: normalized.ailment,
            lsqLeadId: normalized.lsqLeadId,
          },
        }).catch(() => { /* non-blocking */ });
        break;
      case 'updated': result.leadsUpdated = 1; break;
      case 'skipped': result.leadsSkipped = 1; break;
    }
  } catch (error) {
    result.errors.push(`Failed to sync lead ${prospectId}: ${error}`);
  }

  result.durationMs = Date.now() - startTime;
  await completeSyncRun(syncRunId, result);
  return result;
}

// ============================================
// SYNC LOG
// ============================================

/**
 * Create a sync run record at the START of a sync.
 * Returns the ID so API calls can be linked to it.
 */
async function startSyncRun(syncType: string, triggerStage: string | null): Promise<string | null> {
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO lsq_sync_log (sync_type, trigger_stage, leads_found, leads_created, leads_updated, leads_skipped)
       VALUES ($1, $2, 0, 0, 0, 0)
       RETURNING id`,
      [syncType, triggerStage]
    );
    const id = row?.id || null;
    if (id) setCurrentSyncRunId(id);
    return id;
  } catch (error) {
    console.error('[LSQ Sync] Failed to start sync run log:', error);
    return null;
  }
}

/**
 * Update a sync run record at the END with final results.
 */
async function completeSyncRun(syncRunId: string | null, result: SyncResult): Promise<void> {
  if (!syncRunId) return;
  try {
    await query(
      `UPDATE lsq_sync_log SET
        leads_found = $2, leads_created = $3, leads_updated = $4, leads_skipped = $5,
        errors = $6, completed_at = NOW(), duration_ms = $7
       WHERE id = $1`,
      [
        syncRunId,
        result.leadsFound,
        result.leadsCreated,
        result.leadsUpdated,
        result.leadsSkipped,
        result.errors.length > 0 ? JSON.stringify(result.errors) : null,
        result.durationMs,
      ]
    );
  } catch (error) {
    console.error('[LSQ Sync] Failed to update sync run:', error);
  } finally {
    setCurrentSyncRunId(null);
  }
}

/**
 * Get the last successful sync time for a given stage.
 * Used by polling to only sync recently changed leads.
 */
export async function getLastSyncTime(stage: string): Promise<string | null> {
  const row = await queryOne<{ completed_at: string }>(
    `SELECT completed_at FROM lsq_sync_log
     WHERE trigger_stage = $1 AND sync_type = 'poll' AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1`,
    [stage]
  );
  return row?.completed_at || null;
}
