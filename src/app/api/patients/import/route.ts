// ============================================
// POST /api/patients/import — Bulk import IP patients from KareXpert CSV
//
// Accepts multipart/form-data with:
//   - file: CSV file (KareXpert IP patient export)
//   - date: optional date string (for reference, default today)
//
// Smart matching logic (3-tier):
//   1. Parse CSV rows
//   2. For each row, match against existing patients:
//      Tier 1: UHID match (case-insensitive, strongest)
//      Tier 2: Name + phone match (catches LSQ patients without UHID)
//      Tier 3: No match → create new patient
//   3. Forward-only stage advancement:
//      - If existing patient is at opd/pre_admission → advance to admitted
//      - If existing patient is at admitted or beyond → keep their stage
//      - NEVER regress a patient's journey stage
//   4. Always enrich KX operational fields (bed, ward, IP#, doctors, payer)
//      while preserving LSQ tracking fields (lsq_lead_id, etc.)
//   5. Match or create doctor profiles (stub profiles for unknown doctors)
//   6. For new patients: create GetStream channel with auto-enrolled staff
//   7. Return summary: { created, advanced, enriched, skipped, errors }
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createPatientThread,
  updatePatientThread,
  findProfilesByRole,
  getDepartmentHead,
} from '@/lib/db-v5';
import { query, queryOne } from '@/lib/db';
import {
  createPatientChannel,
  sendSystemMessage,
  syncUserToGetStream,
} from '@/lib/getstream';

// Track which profile IDs have been synced to GetStream in this request
const syncedToGetStream = new Set<string>();

/**
 * Ensure a profile exists in GetStream before using it as a channel member.
 * Caches within the request to avoid redundant upserts.
 */
async function ensureGetStreamUser(profileId: string): Promise<void> {
  if (syncedToGetStream.has(profileId)) return;
  const profile = await queryOne<{
    id: string; full_name: string; email: string; role: string; department_id: string | null;
  }>(
    `SELECT id, full_name, email, role, department_id FROM profiles WHERE id = $1`,
    [profileId]
  );
  if (profile) {
    await syncUserToGetStream({
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      department_id: profile.department_id,
    });
    syncedToGetStream.add(profileId);
  }
}

// ── CSV column → Rounds field mapping ──

interface CSVRow {
  uhid: string;
  patient_name: string;
  mobile: string;
  admission_no: string;
  age: string;
  gender: string;
  bed_no: string;
  admission_status: string;
  marked_for_discharge: string;
  payer_type: string;
  payer_name: string;
  admission_date: string;
  admission_type: string;
  admitting_doctor: string;
  admitting_specialty: string;
  treating_doctor: string;
  treating_specialty: string;
  ward_name: string;
  room: string;
  floor: string;
  lead_source: string;
  kin_contact: string;
  high_risk: string;
}

// Map KareXpert specialties to EHRC department slugs
const SPECIALTY_TO_DEPT_SLUG: Record<string, string> = {
  'orthopedics': 'ot',
  'orthopaedics': 'ot',
  'general surgery': 'ot',
  'surgery': 'ot',
  'internal medicine': 'nursing', // closest operational dept
  'medicine': 'nursing',
  'emergency': 'emergency',
  'emergency medicine': 'emergency',
  'radiology': 'radiology',
  'pharmacy': 'pharmacy',
  'diet': 'diet',
  'lab': 'clinical-lab',
  'clinical lab': 'clinical-lab',
  'nursing': 'nursing',
  'physiotherapy': 'nursing',
  'anaesthesia': 'ot',
  'anesthesia': 'ot',
  'anaesthesiology': 'ot',
  'anesthesiology': 'ot',
  'cardiology': 'nursing',
  'neurology': 'nursing',
  'nephrology': 'nursing',
  'urology': 'ot',
  'ent': 'ot',
  'ophthalmology': 'ot',
  'dermatology': 'nursing',
  'gastroenterology': 'nursing',
  'pulmonology': 'nursing',
  'oncology': 'nursing',
  'gynecology': 'ot',
  'obstetrics': 'nursing',
  'pediatrics': 'nursing',
};

function parseDateStr(dateStr: string): string | null {
  if (!dateStr) return null;
  // Format: "30/03/2026, 07:51 am" or "30/03/2026"
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})\s*(am|pm))?/i);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min, ampm] = match;
  let hour = hh ? parseInt(hh) : 0;
  const minute = min ? parseInt(min) : 0;
  if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${yyyy}-${mm}-${dd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function mapRow(raw: Record<string, string>): CSVRow {
  return {
    uhid: raw['UHID'] || '',
    patient_name: raw['Patient Name'] || '',
    mobile: raw['Mobile No'] || '',
    admission_no: raw['Admission No'] || '',
    age: raw['Age'] || '',
    gender: raw['Gender'] || '',
    bed_no: raw['Bed No.'] || '',
    admission_status: raw['Admission Status'] || '',
    marked_for_discharge: raw['Marked For Discharge'] || '',
    payer_type: raw['Payer Type'] || '',
    payer_name: raw['Payer Name'] || '',
    admission_date: raw['Admission Date/Time'] || '',
    admission_type: raw['Admission Type'] || '',
    admitting_doctor: raw['Admitting Doctor/Team'] || '',
    admitting_specialty: raw['Admitting Doctor Speciality'] || '',
    treating_doctor: raw['Treating Doctor/Team'] || '',
    treating_specialty: raw['Treating Doctor Speciality'] || '',
    ward_name: raw['Ward Name'] || '',
    room: raw['Room'] || '',
    floor: raw['Floor'] || '',
    lead_source: raw['Leadsource'] || '',
    kin_contact: raw['Kin Contact'] || '',
    high_risk: raw['High Risk'] || '',
  };
}

// ── Doctor profile matching / creation ──

// Cache to avoid repeated lookups within the same import
const doctorCache = new Map<string, string | null>();
const deptCache = new Map<string, string | null>();

async function findOrCreateDoctor(
  doctorName: string,
  specialty: string
): Promise<string | null> {
  if (!doctorName) return null;

  // Normalize name for matching
  const normalizedName = doctorName.trim();
  const cacheKey = normalizedName.toLowerCase();

  if (doctorCache.has(cacheKey)) {
    return doctorCache.get(cacheKey) || null;
  }

  // Try exact match first
  let profile = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE LOWER(full_name) = LOWER($1) AND status = 'active'`,
    [normalizedName]
  );

  if (!profile) {
    // Try fuzzy: strip "Dr " prefix and try
    const nameWithoutTitle = normalizedName.replace(/^(Dr\.?\s*|Mr\.?\s*|Mrs\.?\s*|Ms\.?\s*)/i, '').trim();
    profile = await queryOne<{ id: string }>(
      `SELECT id FROM profiles WHERE
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(full_name, 'Dr. ', ''), 'Dr ', ''), 'Mr ', ''), 'Mrs ', '')) ILIKE $1
        AND status = 'active'
      LIMIT 1`,
      [`%${nameWithoutTitle}%`]
    );
  }

  if (profile) {
    doctorCache.set(cacheKey, profile.id);
    return profile.id;
  }

  // Create stub profile
  // Generate a placeholder email from doctor name
  const emailSlug = normalizedName
    .toLowerCase()
    .replace(/^(dr\.?\s*)/i, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  const stubEmail = `${emailSlug}@even.in`;

  // Check if email already exists
  const existingEmail = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE email = $1`,
    [stubEmail]
  );

  if (existingEmail) {
    doctorCache.set(cacheKey, existingEmail.id);
    return existingEmail.id;
  }

  // Get department_id for this specialty
  const deptId = await findDepartmentBySpecialty(specialty);

  try {
    const newProfile = await query<{ id: string }>(
      `INSERT INTO profiles (full_name, email, role, status, department_id, designation, account_type)
       VALUES ($1, $2, 'doctor', 'active', $3, $4, 'internal')
       RETURNING id`,
      [normalizedName, stubEmail, deptId, specialty || 'Doctor']
    );
    if (newProfile[0]) {
      // Immediately sync to GetStream so they can be added to channels
      try {
        await syncUserToGetStream({
          id: newProfile[0].id,
          name: normalizedName,
          email: stubEmail,
          role: 'doctor',
          department_id: deptId,
        });
        syncedToGetStream.add(newProfile[0].id);
      } catch (syncErr) {
        console.error(`Failed to sync stub doctor ${doctorName} to GetStream:`, syncErr);
      }
      doctorCache.set(cacheKey, newProfile[0].id);
      return newProfile[0].id;
    }
  } catch (err) {
    console.error(`Failed to create stub profile for ${doctorName}:`, err);
  }

  doctorCache.set(cacheKey, null);
  return null;
}

async function findDepartmentBySpecialty(specialty: string): Promise<string | null> {
  if (!specialty) return null;

  const key = specialty.toLowerCase().trim();
  if (deptCache.has(key)) return deptCache.get(key) || null;

  // First try exact slug match
  const slug = SPECIALTY_TO_DEPT_SLUG[key];
  if (slug) {
    const dept = await queryOne<{ id: string }>(
      `SELECT id FROM departments WHERE slug = $1`,
      [slug]
    );
    if (dept) {
      deptCache.set(key, dept.id);
      return dept.id;
    }
  }

  // Fallback: try matching department name
  const dept = await queryOne<{ id: string }>(
    `SELECT id FROM departments WHERE LOWER(name) ILIKE $1 LIMIT 1`,
    [`%${key}%`]
  );
  if (dept) {
    deptCache.set(key, dept.id);
    return dept.id;
  }

  deptCache.set(key, null);
  return null;
}

// ── Stage-specific roles (same as POST /api/patients) ──

function getStageRoles(stage: string): string[] {
  switch (stage) {
    case 'admitted': return ['nurse', 'pharmacist'];
    case 'pre_op': return ['anesthesiologist', 'ot_coordinator', 'nurse'];
    case 'surgery': return ['anesthesiologist', 'ot_coordinator'];
    case 'post_op': return ['nurse', 'physiotherapist'];
    case 'discharge': return ['billing_executive', 'pharmacist'];
    default: return [];
  }
}

// ── Main handler ──

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can bulk import
    if (!['super_admin', 'department_head'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admins can import patients' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No CSV file provided' },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const rawRows = parseCSV(csvText);

    if (rawRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'CSV file is empty or has no data rows' },
        { status: 400 }
      );
    }

    const rows = rawRows.map(mapRow).filter(r => r.uhid && r.patient_name);

    // ── Stage ordering for forward-only advancement ──
    // KX import can only set 'admitted'. If a patient is already at or past
    // 'admitted', we must NOT regress their stage. We define a numeric order
    // so that stage comparisons are a simple integer check.
    const STAGE_ORDER: Record<string, number> = {
      opd: 0,
      pre_admission: 1,
      admitted: 2,
      pre_op: 3,
      medical_management: 3,   // same level as pre_op — both are post-admission
      surgery: 4,
      post_op: 5,
      post_op_care: 5,         // same level as post_op
      discharge: 6,
      long_term_followup: 7,
      post_discharge: 8,
    };
    const ADMITTED_ORDER = STAGE_ORDER['admitted']; // 2

    // ── Pre-load ALL existing patients for multi-field matching ──
    // This enables: (1) UHID match, (2) name+phone fallback for LSQ patients
    interface ExistingPatient {
      id: string;
      uhid: string | null;
      patient_name: string;
      phone: string | null;
      current_stage: string;
      getstream_channel_id: string | null;
      lsq_lead_id: string | null;
    }
    const allExisting = await query<ExistingPatient>(
      `SELECT id, uhid, patient_name, phone, current_stage,
              getstream_channel_id, lsq_lead_id
       FROM patient_threads
       WHERE archived_at IS NULL`
    );

    // Build lookup indexes
    const byUhid = new Map<string, ExistingPatient>();
    const byNamePhone = new Map<string, ExistingPatient>();
    for (const p of allExisting) {
      if (p.uhid) byUhid.set(p.uhid.toLowerCase(), p);
      // Index by normalized name + phone for LSQ patient matching
      if (p.phone) {
        const nameKey = p.patient_name.toLowerCase().replace(/\s+/g, ' ').trim();
        const phoneKey = p.phone.replace(/\D/g, '').slice(-10); // last 10 digits
        byNamePhone.set(`${nameKey}|${phoneKey}`, p);
      }
    }

    // Clear caches for this import batch
    doctorCache.clear();
    deptCache.clear();
    syncedToGetStream.clear();

    // Track UHIDs processed in THIS batch to avoid within-batch duplicates
    const batchUhids = new Set<string>();

    const results: {
      created: string[];
      advanced: string[];     // stage moved forward (e.g., opd → admitted)
      enriched: string[];     // fields updated but stage already at/past admitted
      skipped: string[];      // exact duplicate (same UHID, already admitted+)
      errors: { uhid: string; name: string; error: string }[];
    } = {
      created: [],
      advanced: [],
      enriched: [],
      skipped: [],
      errors: [],
    };

    for (const row of rows) {
      // Skip within-batch duplicates
      if (batchUhids.has(row.uhid.toLowerCase())) {
        results.skipped.push(`${row.patient_name} (${row.uhid}) — duplicate in CSV`);
        continue;
      }
      batchUhids.add(row.uhid.toLowerCase());

      try {
        // ── 3-tier matching ──
        // Tier 1: UHID match (strongest)
        let existing = byUhid.get(row.uhid.toLowerCase()) || null;

        // Tier 2: Name + phone match (catches LSQ patients without UHID)
        if (!existing && row.mobile) {
          const nameKey = row.patient_name.toLowerCase().replace(/\s+/g, ' ').trim();
          const phoneKey = row.mobile.replace(/\D/g, '').slice(-10);
          existing = byNamePhone.get(`${nameKey}|${phoneKey}`) || null;
        }

        // Match or create doctor (shared for both new + existing paths)
        const doctorId = await findOrCreateDoctor(row.admitting_doctor, row.admitting_specialty);
        const deptId = await findDepartmentBySpecialty(row.admitting_specialty);
        const admissionDate = parseDateStr(row.admission_date);

        // Build ward/bed/payer context string
        const contextParts: string[] = [];
        if (row.ward_name) contextParts.push(`Ward: ${row.ward_name}`);
        if (row.bed_no) contextParts.push(`Bed: ${row.bed_no}`);
        if (row.floor) contextParts.push(`Floor: ${row.floor}`);
        if (row.payer_type && row.payer_type !== 'Cash') contextParts.push(`Payer: ${row.payer_name || row.payer_type}`);
        if (row.high_risk === 'Yes') contextParts.push('HIGH RISK');
        const contextStr = contextParts.length > 0 ? contextParts.join(' | ') : null;

        // ╔══════════════════════════════════════════╗
        // ║  PATH A: Existing patient found — merge  ║
        // ╚══════════════════════════════════════════╝
        if (existing) {
          const currentOrder = STAGE_ORDER[existing.current_stage] ?? 0;
          const shouldAdvance = currentOrder < ADMITTED_ORDER;

          // Build the UPDATE fields — always enrich operational data from KX
          // but NEVER overwrite LSQ tracking fields
          const updateFields: Record<string, unknown> = {
            uhid: row.uhid,                              // ensure UHID is set (LSQ patients may lack it)
            ip_number: row.admission_no || undefined,
            primary_diagnosis: contextStr || undefined,   // ward/bed/payer context
          };
          if (doctorId) updateFields.primary_consultant_id = doctorId;
          if (deptId) updateFields.department_id = deptId;
          if (admissionDate) updateFields.admission_date = admissionDate;

          // Forward-only stage advancement
          if (shouldAdvance) {
            updateFields.current_stage = 'admitted';
          }
          // If currentOrder >= ADMITTED_ORDER, we do NOT touch current_stage

          await updatePatientThread(existing.id, updateFields);

          // Log a changelog entry for stage advancement
          if (shouldAdvance) {
            try {
              await query(
                `INSERT INTO patient_changelog
                   (patient_thread_id, change_type, field_name, old_value, new_value,
                    old_display, new_display, changed_by, notes)
                 VALUES ($1, 'stage_change', 'current_stage', $2, 'admitted', $3, 'Admitted', $4, $5)`,
                [
                  existing.id,
                  existing.current_stage,
                  existing.current_stage,
                  user.profileId,
                  `Advanced from ${existing.current_stage} to admitted via KX import (${row.uhid})`,
                ]
              );
            } catch { /* non-fatal changelog */ }

            // Post system message to existing GetStream channel if it exists
            if (existing.getstream_channel_id) {
              try {
                await sendSystemMessage(
                  'patient-thread',
                  existing.getstream_channel_id,
                  `📋 ${row.patient_name} admitted via KareXpert (${row.uhid}). ` +
                  `Stage advanced from ${existing.current_stage} → admitted. ` +
                  `IP: ${row.admission_no || 'N/A'} | Dr. ${row.admitting_doctor || 'Unassigned'}`
                );
              } catch { /* non-fatal */ }
            }

            results.advanced.push(
              `${row.patient_name} (${row.uhid}) — ${existing.current_stage} → admitted` +
              (existing.lsq_lead_id ? ' [LSQ patient]' : '')
            );
          } else {
            // Patient already at or past admitted — just enriched fields
            // Post a quieter system message about field update
            if (existing.getstream_channel_id) {
              try {
                await sendSystemMessage(
                  'patient-thread',
                  existing.getstream_channel_id,
                  `📋 KX data refreshed for ${row.patient_name} (${row.uhid}). ` +
                  `Stage unchanged: ${existing.current_stage}. ` +
                  `Bed: ${row.bed_no || 'N/A'} | Ward: ${row.ward_name || 'N/A'}`
                );
              } catch { /* non-fatal */ }
            }

            results.enriched.push(
              `${row.patient_name} (${row.uhid}) — stage kept at ${existing.current_stage}, fields updated`
            );
          }

          // Update the UHID index so subsequent rows don't re-match
          if (!existing.uhid) {
            byUhid.set(row.uhid.toLowerCase(), { ...existing, uhid: row.uhid });
          }

          continue;
        }

        // ╔══════════════════════════════════════════╗
        // ║  PATH B: No match — create new patient   ║
        // ╚══════════════════════════════════════════╝

        const patientResult = await createPatientThread({
          patient_name: row.patient_name,
          uhid: row.uhid,
          ip_number: row.admission_no,
          current_stage: 'admitted',
          primary_consultant_id: doctorId || undefined,
          department_id: deptId || undefined,
          admission_date: admissionDate || undefined,
          lead_source: row.lead_source || undefined,
          primary_diagnosis: contextStr || undefined,
          created_by: user.profileId,
        });

        // Add to UHID index to prevent within-batch re-match
        byUhid.set(row.uhid.toLowerCase(), {
          id: patientResult.id,
          uhid: row.uhid,
          patient_name: row.patient_name,
          phone: row.mobile || null,
          current_stage: 'admitted',
          getstream_channel_id: null,
          lsq_lead_id: null,
        });

        // Create GetStream channel with auto-enrolled staff
        const memberIds = new Set<string>();
        memberIds.add(user.profileId);
        if (doctorId) memberIds.add(doctorId);

        // Add IP coordinators
        try {
          const ipCoords = await findProfilesByRole(['ip_coordinator']);
          ipCoords.forEach(p => memberIds.add(p.id));
        } catch { /* non-fatal */ }

        // Add department head
        if (deptId) {
          try {
            const headId = await getDepartmentHead(deptId);
            if (headId) memberIds.add(headId);
          } catch { /* non-fatal */ }
        }

        // Add stage roles for 'admitted'
        try {
          const stageStaff = await findProfilesByRole(getStageRoles('admitted'), deptId || undefined);
          stageStaff.forEach(p => memberIds.add(p.id));
        } catch { /* non-fatal */ }

        // Sync all members to GetStream before channel creation
        for (const memberId of memberIds) {
          try {
            await ensureGetStreamUser(memberId);
          } catch {
            memberIds.delete(memberId);
          }
        }

        try {
          const channelId = await createPatientChannel({
            patientThreadId: patientResult.id,
            patientName: row.patient_name,
            uhid: row.uhid,
            currentStage: 'admitted',
            departmentId: deptId,
            createdById: user.profileId,
            memberIds: [...memberIds],
          });

          await updatePatientThread(patientResult.id, {
            getstream_channel_id: channelId as unknown as string,
          });

          await sendSystemMessage(
            'patient-thread',
            channelId,
            `📋 ${row.patient_name} (${row.uhid}) imported from KareXpert. IP: ${row.admission_no || 'N/A'} | Dr. ${row.admitting_doctor || 'Unassigned'} | ${row.admitting_specialty || ''}`
          );
        } catch (err) {
          console.error(`Channel creation failed for ${row.uhid}:`, err);
          // Non-fatal — patient DB record still created
        }

        results.created.push(`${row.patient_name} (${row.uhid})`);
      } catch (err) {
        console.error(`Failed to import ${row.uhid}:`, err);
        results.errors.push({
          uhid: row.uhid,
          name: row.patient_name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total_in_csv: rows.length,
        created: results.created.length,
        advanced: results.advanced.length,
        enriched: results.enriched.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
        created_list: results.created,
        advanced_list: results.advanced,
        enriched_list: results.enriched,
        skipped_list: results.skipped,
        error_list: results.errors,
      },
      message: `Import complete: ${results.created.length} new, ${results.advanced.length} advanced to admitted, ${results.enriched.length} fields updated, ${results.skipped.length} skipped, ${results.errors.length} errors.`,
    });
  } catch (error) {
    console.error('POST /api/patients/import error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process import' },
      { status: 500 }
    );
  }
}
