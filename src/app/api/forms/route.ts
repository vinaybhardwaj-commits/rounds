// ============================================
// GET  /api/forms — list form submissions
// POST /api/forms — submit a form + auto-create
//   readiness items from schema definitions
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createFormSubmission, listFormSubmissions, createReadinessItem } from '@/lib/db-v5';
import { query as sqlQuery, queryOne } from '@/lib/db';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  getReadinessItemDefs,
  validateFormData,
  computeCompletionScore,
} from '@/lib/form-registry';
import { sendSystemMessage } from '@/lib/getstream';
import { postPatientActivity } from '@/lib/patient-activity';
import { getOrCreateClaim, logClaimEvent, postClaimMessage } from '@/lib/insurance-claims';
import { calculateMilestoneAttribution } from '@/lib/billing-metrics';
import { audit } from '@/lib/audit';
import { validateDoctorHospitalAffiliation } from '@/lib/validate-doctor-hospital';
import type { FormType, FormStatus } from '@/types';
import { ROOM_RENT_ELIGIBILITY_PCT } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const form_type = searchParams.get('form_type') as FormType | null;
    const patient_thread_id = searchParams.get('patient_thread_id');
    const status = searchParams.get('status') as FormStatus | null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const forms = await listFormSubmissions({
      form_type: form_type || undefined,
      patient_thread_id: patient_thread_id || undefined,
      status: status || undefined,
      limit,
      offset,
      // 25 Apr 2026 (L12): scope list to caller's accessible hospitals.
      user_profile_id: user.profileId,
    });

    return NextResponse.json({ success: true, data: forms });
  } catch (error) {
    console.error('GET /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list form submissions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { form_type, form_data } = body;

    if (!form_type) {
      return NextResponse.json(
        { success: false, error: 'form_type is required' },
        { status: 400 }
      );
    }
    if (!form_data || typeof form_data !== 'object') {
      return NextResponse.json(
        { success: false, error: 'form_data object is required' },
        { status: 400 }
      );
    }

    // Look up schema (optional — form engine may not define all types yet)
    const schema = FORM_REGISTRY[form_type as FormType];

    // Server-side validation (only if schema exists and status is not 'draft')
    const status = body.status || 'submitted';
    if (schema && status !== 'draft') {
      const validationErrors = validateFormData(schema, form_data);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            validationErrors,
          },
          { status: 422 }
        );
      }
    }

    // Compute completion score from schema
    const completionScore = schema
      ? computeCompletionScore(schema, form_data)
      : body.completion_score || null;

    // Create the form submission
    const result = await createFormSubmission({
      form_type,
      form_version: schema?.version || body.form_version || 1,
      form_data,
      submitted_by: user.profileId,
      patient_thread_id: body.patient_thread_id || undefined,
      getstream_message_id: body.getstream_message_id || undefined,
      getstream_channel_id: body.getstream_channel_id || undefined,
      department_id: body.department_id || undefined,
      completion_score: completionScore,
      status,
    });

    const formId = result.id;

    // ── 25 Apr 2026 — Mirror Marketing Handoff target_department onto patient_thread ──
    // The Patient Overview clinical Department picker reads from
    // patient_threads.target_department. Keeping it in sync with the latest
    // submitted handoff means the patient's stored specialty matches what was
    // last submitted by the marketing/intake team. Surgical + non-surgical
    // alike. Skipped for drafts (status='draft' submissions don't count).
    if (
      form_type === 'consolidated_marketing_handoff' &&
      status !== 'draft' &&
      body.patient_thread_id &&
      typeof form_data.target_department === 'string' &&
      form_data.target_department.trim() !== ''
    ) {
      try {
        await sqlQuery(
          `UPDATE patient_threads
              SET target_department = $1, updated_at = NOW()
            WHERE id = $2`,
          [(form_data.target_department as string).trim(), body.patient_thread_id]
        );
      } catch (mirrorErr) {
        // Don't fail the form submit on this — log only.
        console.error('[forms] target_department mirror failed:', mirrorErr);
      }
    }

    // ── Sprint 1 Day 4 — Consolidated Marketing Handoff → Draft surgical_case Hook ──
    // When a handoff submits with surgery_planned=true AND FEATURE_CASE_MODEL_ENABLED,
    // create a surgical_cases row in state='draft' + case_state_events row for audit.
    // Decision: Framing B (PRD v3.0) — case entity is born at handoff submit time.
    // Also syncs patient_threads.hospital_id from target_hospital (keeps patient + case
    // in the same hospital if marketing re-routes). All behind the feature flag so
    // Sprint 1 can test end-to-end without user-facing side effects.
    if (
      form_type === 'consolidated_marketing_handoff' &&
      status !== 'draft' &&
      process.env.FEATURE_CASE_MODEL_ENABLED === 'true' &&
      form_data.surgery_planned === true &&
      body.patient_thread_id
    ) {
      try {
        // Resolve target_hospital slug → hospital_id.
        const hospitalSlug = (form_data.target_hospital as string | undefined)?.toLowerCase();
        const hospital = hospitalSlug
          ? await queryOne<{ id: string }>(
              `SELECT id FROM hospitals WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
              [hospitalSlug]
            )
          : null;

        if (!hospital) {
          console.warn(
            `[Sprint1.CaseModel] Skipping draft creation — target_hospital "${hospitalSlug}" not active or missing.`
          );
        } else {
          // Sync patient_threads.hospital_id to match the handoff's target.
          // This handles re-routing: patient originally EHRC → marketing re-routes to EHBR.
          await sqlQuery(
            `UPDATE patient_threads SET hospital_id = $1, updated_at = NOW() WHERE id = $2 AND hospital_id IS DISTINCT FROM $1`,
            [hospital.id, body.patient_thread_id]
          );

          // Extract additional case metadata from the handoff.
          const urgency = (() => {
            const u = form_data.surgery_urgency as string | undefined;
            if (u && ['elective', 'urgent', 'emergency'].includes(u)) return u;
            return 'elective';
          })();
          const plannedProcedure = (form_data.proposed_procedure as string | undefined) || null;
          const plannedSurgeryDate = (form_data.preferred_surgery_date as string | undefined) || null;

          // Create surgical_cases row (state='draft').
          const caseInsert = await queryOne<{ id: string }>(
            `INSERT INTO surgical_cases
               (hospital_id, patient_thread_id, handoff_submission_id,
                planned_procedure, planned_surgery_date, urgency,
                state, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
             RETURNING id`,
            [
              hospital.id,
              body.patient_thread_id,
              formId,
              plannedProcedure,
              plannedSurgeryDate,
              urgency,
              user.profileId,
            ]
          );

          if (caseInsert) {
            // Append the initial state event (Invariant: every state mutation logs).
            await sqlQuery(
              `INSERT INTO case_state_events
                 (case_id, from_state, to_state, transition_reason, actor_profile_id, metadata)
               VALUES ($1, NULL, 'draft', $2, $3, $4::jsonb)`,
              [
                caseInsert.id,
                'handoff_submit',
                user.profileId,
                JSON.stringify({ handoff_submission_id: formId }),
              ]
            );
            console.log(
              `[Sprint1.CaseModel] Created draft surgical_case ${caseInsert.id} from handoff ${formId}`
            );

            // 25 Apr 2026: auto-create an 'Initiate PAC' task for the IP
            // coordinator. Per V's clarification of EHRC workflow: as soon as
            // the marketing handoff lands, the IP coordinator picks up the case
            // and begins PAC coordination with anaesthetist + labs + clinical
            // depts \u2014 independent of whether the patient is admitted yet.
            // Idempotent via the tasks (case_id, source_ref) WHERE source='auto'
            // unique partial index, so re-submitting the handoff doesn't double
            // up the task.
            try {
              const ptName = (await queryOne<{ patient_name: string | null }>(
                `SELECT patient_name FROM patient_threads WHERE id = $1`,
                [body.patient_thread_id]
              ))?.patient_name ?? 'patient';
              await sqlQuery(
                `
                INSERT INTO tasks
                  (hospital_id, case_id, title, description, owner_role,
                   status, source, source_ref, metadata, created_by)
                VALUES ($1, $2, $3, $4, 'ip_coordinator',
                  'pending', 'auto', 'case:initiate_pac', $5::jsonb, $6)
                ON CONFLICT (case_id, source_ref) WHERE source = 'auto' AND case_id IS NOT NULL
                DO UPDATE SET updated_at = NOW()
                `,
                [
                  hospital.id,
                  caseInsert.id,
                  `Initiate PAC for ${ptName}`,
                  `Marketing handoff submitted. Begin PAC coordination with anaesthetist + labs + clinical departments. Link case to KarExpert and schedule the PAC. PAC can start before admission \u2014 no need to wait for the patient to be admitted.`,
                  JSON.stringify({ handoff_submission_id: formId }),
                  user.profileId,
                ]
              );
            } catch (taskErr) {
              console.error('[Sprint1.CaseModel] auto-task insert failed (non-fatal):', (taskErr as Error).message);
            }
          }
        }
      } catch (err) {
        console.error('[Sprint1.CaseModel] Failed to create draft case — non-fatal:', err);
        // Don't fail the handoff submission; the case can be created manually later.
      }
    }

    // ── Version Chain Logic (Sprint 1 Day 5 — extended to all handoff-family forms) ──
    // Any form in VERSIONED_FORM_TYPES gets auto-linked to its previous submission for the
    // same patient_thread. Sets parent_submission_id, increments version_number, records
    // change_reason. Non-fatal — a failure here does not fail the submission.
    const VERSIONED_FORM_TYPES = new Set<FormType>([
      'consolidated_marketing_handoff',
      'financial_counseling',
      'surgery_booking',
      'admission_advice',
    ] as FormType[]);

    if (VERSIONED_FORM_TYPES.has(form_type as FormType) && body.patient_thread_id) {
      try {
        const prevSubmission = await queryOne<{ id: string; version_number: number }>(
          `SELECT id, version_number FROM form_submissions
           WHERE form_type = $1
             AND patient_thread_id = $2
             AND id != $3
           ORDER BY version_number DESC NULLS LAST, created_at DESC
           LIMIT 1`,
          [form_type, body.patient_thread_id, formId]
        );

        if (prevSubmission) {
          const newVersionNumber = (prevSubmission.version_number || 0) + 1;
          const changeReason = body.change_reason || null;

          await sqlQuery(
            `UPDATE form_submissions
             SET parent_submission_id = $1, version_number = $2, change_reason = $3
             WHERE id = $4`,
            [prevSubmission.id, newVersionNumber, changeReason, formId]
          );
        } else {
          // First submission in the chain — record as version 1 so diffs against future versions work.
          await sqlQuery(
            `UPDATE form_submissions
             SET version_number = 1
             WHERE id = $1 AND version_number IS NULL`,
            [formId]
          );
        }
      } catch (err) {
        console.error(`[VersionChain] Failed to link ${form_type} versions:`, err);
        // Non-fatal — form submission still succeeds
      }
    }

    // Auto-generate readiness items from schema (only for submitted, not draft)
    let readinessItemsCreated = 0;
    if (schema && status !== 'draft') {
      const readinessDefs = getReadinessItemDefs(schema);

      for (const def of readinessDefs) {
        // Only create readiness item if the checkbox was checked (truthy)
        // or if the field doesn't exist in form_data (create all for non-checkbox schemas)
        const fieldValue = form_data[def.fieldKey];
        const fieldDef = schema.sections
          .flatMap((s) => s.fields)
          .find((f) => f.key === def.fieldKey);

        // For checkbox fields: create item only if checked
        // For non-checkbox fields: always create
        const isCheckbox = fieldDef?.type === 'checkbox';
        if (isCheckbox && !fieldValue) continue;

        // Calculate due_by from SLA hours
        let dueBy: string | undefined;
        if (def.slaHours) {
          const due = new Date();
          due.setHours(due.getHours() + def.slaHours);
          dueBy = due.toISOString();
        }

        try {
          await createReadinessItem({
            form_submission_id: formId,
            patient_thread_id: body.patient_thread_id || undefined,
            item_name: def.itemName,
            item_category: def.category,
            item_description: def.description,
            responsible_role: def.responsibleRole,
            due_by: dueBy,
          });
          readinessItemsCreated++;
        } catch (err) {
          console.error(`Failed to create readiness item "${def.itemName}":`, err);
          // Don't fail the whole submission for a readiness item error
        }
      }
    }

    // ── Financial Counseling → Insurance Claim Hook ──
    // When financial_counseling is submitted with payment_mode = 'insurance',
    // create/update the insurance_claims row and admission_tracker billing fields.
    if (form_type === 'financial_counseling' && status !== 'draft' && body.patient_thread_id) {
      const fd = form_data as Record<string, unknown>;
      if (fd.payment_mode === 'insurance' || fd.payment_mode === 'insurance_cash') {
        try {
          // Get or create insurance claim
          const claim = await getOrCreateClaim(body.patient_thread_id, user.profileId);

          // Calculate room rent eligibility and proportional deduction
          const sumInsuredRaw = fd.sum_insured ? Number(fd.sum_insured) : NaN;
          const sumInsured = !isNaN(sumInsuredRaw) ? sumInsuredRaw : null;
          const roomCategory = (fd.room_category as string) || null;
          const actualRoomRentRaw = fd.actual_room_rent ? Number(fd.actual_room_rent) : NaN;
          const actualRoomRent = !isNaN(actualRoomRentRaw) ? actualRoomRentRaw : null;
          const isIcu = roomCategory === 'icu' || roomCategory === 'nicu';
          const eligibilityPct = isIcu ? ROOM_RENT_ELIGIBILITY_PCT.icu : ROOM_RENT_ELIGIBILITY_PCT.standard;
          const roomRentEligibility = sumInsured ? Math.round(sumInsured * eligibilityPct) : null;
          const hasWaiver = !!fd.has_room_rent_waiver;

          let proportionalDeductionPct: number | null = null;
          if (!hasWaiver && roomRentEligibility && actualRoomRent && actualRoomRent > 0 && actualRoomRent > roomRentEligibility) {
            proportionalDeductionPct = Math.round(((actualRoomRent - roomRentEligibility) / actualRoomRent) * 10000) / 100;
          }

          // Update the insurance claim with counseling data
          const claimSets: string[] = [];
          const claimParams: unknown[] = [claim.id];
          let cIdx = 2;

          const setField = (col: string, val: unknown) => {
            if (val != null && val !== '') {
              claimSets.push(`${col} = $${cIdx}`);
              claimParams.push(val);
              cIdx++;
            }
          };

          setField('insurer_name', fd.insurance_provider);
          setField('tpa_name', fd.tpa_name === 'Direct' ? null : fd.tpa_name);
          setField('submission_channel', fd.submission_channel || (fd.tpa_name === 'Direct' ? 'direct' : 'tpa'));
          setField('portal_used', fd.portal_used);
          setField('policy_number', fd.policy_number);
          setField('sum_insured', sumInsured);
          setField('room_rent_eligibility', roomRentEligibility);
          setField('room_category_selected', roomCategory);
          setField('actual_room_rent', actualRoomRent);
          setField('proportional_deduction_pct', proportionalDeductionPct);
          setField('has_room_rent_waiver', hasWaiver);
          setField('co_pay_pct', fd.co_pay_pct ? Number(fd.co_pay_pct) : null);
          setField('estimated_cost', fd.estimated_cost ? Number(fd.estimated_cost) : null);

          if (claimSets.length > 0) {
            await sqlQuery(
              `UPDATE insurance_claims SET ${claimSets.join(', ')} WHERE id = $1`,
              claimParams
            );
          }

          // Update admission_tracker billing fields
          const atSets: string[] = [];
          const atParams: unknown[] = [body.patient_thread_id];
          let aIdx = 2;

          const setAt = (col: string, val: unknown) => {
            if (val != null) {
              atSets.push(`${col} = $${aIdx}`);
              atParams.push(val);
              aIdx++;
            }
          };

          setAt('insurance_claim_id', claim.id);
          setAt('insurer_name', fd.insurance_provider);
          setAt('submission_channel', fd.submission_channel || (fd.tpa_name === 'Direct' ? 'direct' : 'tpa'));
          setAt('sum_insured', sumInsured);
          setAt('room_rent_eligibility', roomRentEligibility);
          setAt('proportional_deduction_risk', proportionalDeductionPct);

          if (atSets.length > 0) {
            await sqlQuery(
              `UPDATE admission_tracker SET ${atSets.join(', ')}
               WHERE patient_thread_id = $1 AND current_status != 'discharged'`,
              atParams
            );
          }

          // Log counseling_completed event on the claim
          const profile = await queryOne<{ full_name: string }>(
            `SELECT full_name FROM profiles WHERE id = $1`,
            [user.profileId]
          );
          const actorName = profile?.full_name || user.email;

          // Build description for system message
          let counselingDesc = `Insurer: ${fd.insurance_provider || 'Unknown'}`;
          if (fd.tpa_name && fd.tpa_name !== 'Direct') counselingDesc += ` via ${fd.tpa_name}`;
          if (sumInsured) counselingDesc += ` | Sum Insured: ₹${sumInsured.toLocaleString('en-IN')}`;
          if (roomCategory && actualRoomRent) {
            counselingDesc += `\nRoom: ${roomCategory} (₹${actualRoomRent.toLocaleString('en-IN')}/day)`;
            if (roomRentEligibility) counselingDesc += ` | Eligibility: ₹${roomRentEligibility.toLocaleString('en-IN')}/day`;
          }
          if (proportionalDeductionPct && proportionalDeductionPct > 0) {
            counselingDesc += `\n⚠️ Proportional deduction risk: ${proportionalDeductionPct}%`;
            if (fd.estimated_cost) {
              const extraCost = Math.round(Number(fd.estimated_cost) * proportionalDeductionPct / 100);
              counselingDesc += ` (on ₹${Number(fd.estimated_cost).toLocaleString('en-IN')} bill → extra ₹${extraCost.toLocaleString('en-IN')})`;
            }
          }
          if (fd.co_pay_pct && Number(fd.co_pay_pct) > 0) counselingDesc += `\nCo-pay: ${fd.co_pay_pct}%`;
          if (fd.deposit_collected && fd.deposit_collected_amount) {
            counselingDesc += `\nDeposit: ₹${Number(fd.deposit_collected_amount).toLocaleString('en-IN')} (Collected)`;
          }

          await logClaimEvent(
            claim.id,
            body.patient_thread_id,
            'counseling_completed',
            counselingDesc,
            user.profileId,
            actorName,
            { amount: fd.estimated_cost ? Number(fd.estimated_cost) : undefined },
          );

          // Post system message to patient thread
          const patient = await queryOne<{
            patient_name: string;
            getstream_channel_id: string | null;
          }>(
            `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
            [body.patient_thread_id]
          );

          if (patient) {
            // Check if this is a versioned submission
            let versionNote = '';
            const submissionData = await queryOne<{ version_number: number | null }>(
              `SELECT version_number FROM form_submissions WHERE id = $1`,
              [formId]
            );
            if (submissionData?.version_number && submissionData.version_number > 1) {
              versionNote = ` (v${submissionData.version_number})`;
            }

            const sysMsg = `📋 **Financial counseling complete**${versionNote} by ${actorName}\n${counselingDesc}`;
            if (patient.getstream_channel_id) {
              try {
                await sendSystemMessage('patient-thread', patient.getstream_channel_id, sysMsg);
              } catch { /* non-fatal */ }
            }
            try {
              await sendSystemMessage('department', 'billing',
                `📋 ${patient.patient_name}: Financial counseling complete${versionNote} — by ${actorName}`);
            } catch { /* non-fatal */ }

            // CC channel — financial summary for customer care follow-up
            try {
              const ccLines = [
                `💰 **Financial Counseling**${versionNote} — ${patient.patient_name}`,
                `Submitted by: ${actorName}`,
              ];
              if (fd.payment_mode) ccLines.push(`Payment: ${fd.payment_mode}`);
              if (fd.estimated_cost) ccLines.push(`Est. Cost: ₹${Number(fd.estimated_cost).toLocaleString('en-IN')}`);
              if (fd.insurance_provider) ccLines.push(`Insurer: ${fd.insurance_provider}`);
              if (fd.insurance_coverage_amount) ccLines.push(`Coverage: ₹${Number(fd.insurance_coverage_amount).toLocaleString('en-IN')}`);
              if (fd.copay_amount) ccLines.push(`Co-pay: ₹${Number(fd.copay_amount).toLocaleString('en-IN')}`);
              if (fd.deposit_collected && fd.deposit_collected_amount) {
                ccLines.push(`Deposit: ₹${Number(fd.deposit_collected_amount).toLocaleString('en-IN')} ✅ Collected`);
              } else if (fd.deposit_amount) {
                ccLines.push(`Deposit Required: ₹${Number(fd.deposit_amount).toLocaleString('en-IN')} — ⏳ Pending`);
              }
              if (fd.estimate_acknowledged) ccLines.push(`✅ Patient acknowledged costs`);
              ccLines.push(`🔗 View patient thread for full context`);
              await sendSystemMessage('department', 'customer-care', ccLines.join('\n'));
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          console.error('[FinancialCounseling] Claim hook error:', err);
          // Non-fatal — form submission still succeeds
        }
      }
      // Non-insurance patients (cash, corporate, credit) — still route to patient thread, billing, and CC
      if (fd.payment_mode && fd.payment_mode !== 'insurance' && fd.payment_mode !== 'insurance_cash') {
        try {
          const profile = await queryOne<{ full_name: string }>(
            `SELECT full_name FROM profiles WHERE id = $1`,
            [user.profileId]
          );
          const actorName = profile?.full_name || user.email;

          const patient = await queryOne<{
            patient_name: string;
            getstream_channel_id: string | null;
          }>(
            `SELECT patient_name, getstream_channel_id FROM patient_threads WHERE id = $1`,
            [body.patient_thread_id]
          );

          if (patient) {
            let versionNote = '';
            const submissionData = await queryOne<{ version_number: number | null }>(
              `SELECT version_number FROM form_submissions WHERE id = $1`,
              [formId]
            );
            if (submissionData?.version_number && submissionData.version_number > 1) {
              versionNote = ` (v${submissionData.version_number})`;
            }

            let counselingDesc = `Payment: ${fd.payment_mode}`;
            if (fd.estimated_cost) counselingDesc += ` | Est. Cost: ₹${Number(fd.estimated_cost).toLocaleString('en-IN')}`;
            if (fd.deposit_collected && fd.deposit_collected_amount) {
              counselingDesc += `\nDeposit: ₹${Number(fd.deposit_collected_amount).toLocaleString('en-IN')} (Collected)`;
            }

            const sysMsg = `📋 **Financial counseling complete**${versionNote} by ${actorName}\n${counselingDesc}`;

            // Patient thread
            if (patient.getstream_channel_id) {
              try { await sendSystemMessage('patient-thread', patient.getstream_channel_id, sysMsg); } catch { /* non-fatal */ }
            }
            // Billing channel
            try {
              await sendSystemMessage('department', 'billing',
                `📋 ${patient.patient_name}: Financial counseling complete${versionNote} — by ${actorName}`);
            } catch { /* non-fatal */ }
            // CC channel
            try {
              const ccLines = [
                `💰 **Financial Counseling**${versionNote} — ${patient.patient_name}`,
                `Submitted by: ${actorName}`,
                `Payment: ${fd.payment_mode}`,
              ];
              if (fd.estimated_cost) ccLines.push(`Est. Cost: ₹${Number(fd.estimated_cost).toLocaleString('en-IN')}`);
              if (fd.deposit_collected && fd.deposit_collected_amount) {
                ccLines.push(`Deposit: ₹${Number(fd.deposit_collected_amount).toLocaleString('en-IN')} ✅ Collected`);
              } else if (fd.deposit_amount) {
                ccLines.push(`Deposit Required: ₹${Number(fd.deposit_amount).toLocaleString('en-IN')} — ⏳ Pending`);
              }
              if (fd.estimate_acknowledged) ccLines.push(`✅ Patient acknowledged costs`);
              ccLines.push(`🔗 View patient thread for full context`);
              await sendSystemMessage('department', 'customer-care', ccLines.join('\n'));
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          console.error('[FinancialCounseling] Cash routing error:', err);
        }
      }
    }

    // ── Surgery Booking (Standalone) → Patient Thread + OT Channel Hook ──
    // Routes a summary card to the patient thread and OT department channel.
    if (form_type === 'surgery_booking' && status !== 'draft' && body.patient_thread_id) {
      try {
        const fd = form_data as Record<string, unknown>;
        const profile = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [user.profileId]
        );
        const actorName = profile?.full_name || user.email;

        const patient = await queryOne<{
          patient_name: string;
          uhid: string | null;
          getstream_channel_id: string | null;
        }>(
          `SELECT patient_name, uhid, getstream_channel_id FROM patient_threads WHERE id = $1`,
          [body.patient_thread_id]
        );

        if (patient) {
          const pName = patient.patient_name || 'Unknown';
          const pUhid = patient.uhid || '—';
          const val = (v: unknown, fallback?: string) => {
            if (v === undefined || v === null || v === '') return fallback || '⏳ Pending';
            return String(v);
          };

          // Build OT summary lines
          const otLines: string[] = [
            `🔪 **Surgery Booking** — ${pName} (UHID: ${pUhid})`,
            `Submitted by: ${actorName}`,
            '',
            `Surgeon: ${val(fd.surgeon_name)} | Specialty: ${val(fd.surgical_specialty)}`,
            `Procedure: ${val(fd.proposed_procedure)}`,
            `Laterality: ${val(fd.laterality)} | Urgency: ${val(fd.surgery_urgency)}`,
          ];
          if (fd.clinical_justification) otLines.push(`Justification: ${fd.clinical_justification}`);
          if (fd.known_comorbidities && Array.isArray(fd.known_comorbidities) && fd.known_comorbidities.length > 0) {
            otLines.push(`Co-morbidities: ${(fd.known_comorbidities as string[]).join(', ')} | Controlled: ${val(fd.comorbidities_controlled)}`);
          }
          if (fd.habits && Array.isArray(fd.habits) && fd.habits.length > 0) {
            otLines.push(`Habits: ${(fd.habits as string[]).join(', ')}${fd.habits_stopped ? ' | Stopped 3+ days: ' + fd.habits_stopped : ''}`);
          }
          if (fd.current_medication) otLines.push(`Medication: ${fd.current_medication}`);
          otLines.push(`PAC: ${val(fd.pac_status, 'OT to complete')}`);
          otLines.push(`Surgery Date: ${val(fd.preferred_surgery_date, 'OT to schedule')} | Time: ${val(fd.preferred_surgery_time)}`);
          otLines.push(`Duration: ${val(fd.estimated_duration)} | Anaesthesia: ${val(fd.anaesthesia_type, 'Anaesthesia to confirm')}`);
          if (fd.support_requirements) otLines.push(`Support: ${fd.support_requirements}`);
          if (fd.special_requirements) otLines.push(`Special: ${fd.special_requirements}`);
          if (fd.booking_notes) otLines.push(`Notes: ${fd.booking_notes}`);
          otLines.push('', `🔗 View patient thread for full context`);

          // Patient thread message
          if (patient.getstream_channel_id) {
            const threadMsg = `🔪 **Surgery booked** by ${actorName}\n` +
              `Procedure: ${val(fd.proposed_procedure)} | Surgeon: ${val(fd.surgeon_name)}\n` +
              `Urgency: ${val(fd.surgery_urgency)}` +
              (fd.preferred_surgery_date ? ` | Date: ${fd.preferred_surgery_date}` : '');
            try { await sendSystemMessage('patient-thread', patient.getstream_channel_id, threadMsg); } catch { /* non-fatal */ }
          }

          // OT department channel
          try {
            await sendSystemMessage('department', 'ot', otLines.join('\n'));
          } catch {
            try { await sendSystemMessage('department', 'operation-theatre', otLines.join('\n')); } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        console.error('[SurgeryBooking] Routing hook error:', err);
        // Non-fatal — form submission still succeeds
      }
    }

    // ── Admission Advice → Patient Thread + Marketing + Billing Hook ──
    // Routes admission advice summary to patient thread, marketing channel, and billing channel.
    if (form_type === 'admission_advice' && status !== 'draft' && body.patient_thread_id) {
      try {
        const fd = form_data as Record<string, unknown>;
        const profile = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [user.profileId]
        );
        const actorName = profile?.full_name || user.email;

        const patient = await queryOne<{
          patient_name: string;
          uhid: string | null;
          getstream_channel_id: string | null;
        }>(
          `SELECT patient_name, uhid, getstream_channel_id FROM patient_threads WHERE id = $1`,
          [body.patient_thread_id]
        );

        if (patient) {
          const pName = patient.patient_name || 'Unknown';
          const pUhid = patient.uhid || '—';
          const val = (v: unknown, fallback?: string) => {
            if (v === undefined || v === null || v === '') return fallback || '⏳ Pending';
            return String(v);
          };

          // Build marketing/billing summary card
          const summaryLines: string[] = [
            `🏥 **Admission Advice** — ${pName} (UHID: ${pUhid})`,
            `Submitted by: ${actorName}`,
            '',
            `Diagnosis: ${val(fd.diagnosis)}`,
            `Reason: ${val(fd.reason_for_admission)}`,
            `Type: ${val(fd.admission_type)} | Preferred Date: ${val(fd.preferred_date)}`,
            `Expected LOS: ${val(fd.expected_los)} days | Room: ${val(fd.room_preference)}`,
          ];
          if (fd.comorbidities) summaryLines.push(`Comorbidities: ${fd.comorbidities}`);
          if (fd.allergies) summaryLines.push(`Allergies: ${fd.allergies}`);
          if (fd.current_medications) summaryLines.push(`Medications: ${fd.current_medications}`);
          if (fd.special_needs) summaryLines.push(`Special Needs: ${fd.special_needs}`);
          if (fd.diet_order) summaryLines.push(`Diet: ${val(fd.diet_order)}${fd.diet_other ? ' — ' + fd.diet_other : ''}`);
          if (fd.activity_level) summaryLines.push(`Activity: ${val(fd.activity_level)}`);
          if (fd.monitoring_level) summaryLines.push(`Monitoring: ${val(fd.monitoring_level)}`);
          if (fd.investigations_ordered) summaryLines.push(`Investigations: ${fd.investigations_ordered}`);
          summaryLines.push('', `🔗 View patient thread for full context`);

          // Patient thread message (concise)
          if (patient.getstream_channel_id) {
            const threadMsg = `🏥 **Admission advised** by ${actorName}\n` +
              `Diagnosis: ${val(fd.diagnosis)} | Type: ${val(fd.admission_type)}\n` +
              `Preferred Date: ${val(fd.preferred_date)}` +
              (fd.expected_los ? ` | LOS: ${fd.expected_los} days` : '');
            try { await sendSystemMessage('patient-thread', patient.getstream_channel_id, threadMsg); } catch { /* non-fatal */ }
          }

          // Marketing department channel
          try {
            await sendSystemMessage('department', 'marketing', summaryLines.join('\n'));
          } catch {
            try { await sendSystemMessage('department', 'marketing-revenue', summaryLines.join('\n')); } catch { /* non-fatal */ }
          }

          // Billing department channel
          const billingMsg = `📋 ${pName}: Admission advised (${val(fd.admission_type)}) — by ${actorName}\n` +
            `Diagnosis: ${val(fd.diagnosis)} | Date: ${val(fd.preferred_date)} | LOS: ${val(fd.expected_los)} days | Room: ${val(fd.room_preference)}`;
          try {
            await sendSystemMessage('department', 'billing', billingMsg);
          } catch {
            try { await sendSystemMessage('department', 'billing-insurance', billingMsg); } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        console.error('[AdmissionAdvice] Routing hook error:', err);
        // Non-fatal — form submission still succeeds
      }
    }

    // ── Post-Discharge Followup → Feedback Attribution Hook ──
    // When post_discharge_followup is submitted, cross-reference ratings
    // with actual discharge_milestones to calculate milestone attribution.
    if (form_type === 'post_discharge_followup' && status !== 'draft' && body.patient_thread_id) {
      try {
        const attribution = await calculateMilestoneAttribution(body.patient_thread_id);
        if (attribution) {
          // Store attribution alongside ratings in form_data
          await sqlQuery(
            `UPDATE form_submissions
             SET form_data = form_data || $2::jsonb
             WHERE id = $1`,
            [
              formId,
              JSON.stringify({ milestone_attribution: attribution }),
            ]
          );
        }
      } catch (err) {
        console.error('[FeedbackAttribution] Attribution hook error:', err);
        // Non-fatal — form submission still succeeds
      }
    }

    // ── Consolidated Marketing Handoff → Triple-Route Hook ──
    // Posts rich summary cards to: patient thread, CC dept channel, OT dept channel
    // Also advances patient stage to 'admitted'
    if (form_type === 'consolidated_marketing_handoff' && status !== 'draft' && body.patient_thread_id) {
      try {
        const fd = form_data as Record<string, unknown>;

        // Get patient info + submitter name
        const patient = await queryOne<{
          patient_name: string;
          uhid: string | null;
          getstream_channel_id: string | null;
          current_stage: string;
        }>(
          `SELECT patient_name, uhid, getstream_channel_id, current_stage FROM patient_threads WHERE id = $1`,
          [body.patient_thread_id]
        );
        const profile = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [user.profileId]
        );
        const submitterName = profile?.full_name || user.email;
        const pName = patient?.patient_name || 'Unknown';
        const pUhid = patient?.uhid || '—';

        // Helper: mark blank fields as "Pending"
        const val = (v: unknown, label?: string) => {
          if (v === undefined || v === null || v === '') return `⏳ Pending${label ? ' — ' + label : ''}`;
          return String(v);
        };
        const currency = (v: unknown) => {
          if (v === undefined || v === null || v === '') return '⏳ Pending';
          return `₹${Number(v).toLocaleString('en-IN')}`;
        };

        // ── 1. Patient Thread — Full summary card (all 3 sections) ──
        if (patient?.getstream_channel_id) {
          const lines: string[] = [
            `📋 **Marketing Handoff** submitted by ${submitterName}`,
            '',
            `**Section A — Clinical Handoff**`,
            `Priority: ${val(fd.priority)} | OPD Doctor: ${val(fd.target_opd_doctor)} | Dept: ${val(fd.target_department)}`,
            `Clinical Summary: ${val(fd.clinical_summary)}`,
            `Insurance: ${val(fd.insurance_status)} | Preferred Room: ${val(fd.room_category_preference)} | Admission: ${val(fd.preferred_admission_date)}`,
          ];
          if (fd.patient_objections) lines.push(`Concerns: ${fd.patient_objections}`);
          if (fd.special_notes) lines.push(`Notes: ${fd.special_notes}`);
          // Sprint 1 Day 3 — attachments. Array of {url, filename, size, contentType}.
          if (Array.isArray(fd.attachments) && fd.attachments.length > 0) {
            const files = fd.attachments as Array<{ filename?: string }>;
            const names = files.slice(0, 3).map((f) => f.filename || 'file').join(', ');
            const extra = files.length > 3 ? ` +${files.length - 3} more` : '';
            lines.push(`📎 ${files.length} attachment${files.length === 1 ? '' : 's'}: ${names}${extra}`);
          }

          lines.push('', `**Section B — Financial Counseling**`);
          lines.push(`Payment: ${val(fd.payment_mode)} | Est. Cost: ${currency(fd.estimated_total_cost)}`);
          // Sprint 1 Day 3 — surface room billing vs allocated (Niharika's 22 Apr ask).
          if (fd.billing_room_category || fd.allocated_room_category) {
            lines.push(`Billing Room: ${val(fd.billing_room_category)} | Allocated: ${val(fd.allocated_room_category)}`);
          }
          // Sprint 1 Day 3 — lead source + Practo flat-fee flag (22 Apr ask).
          if (fd.lead_source) {
            const flag = fd.lead_source === 'practo' ? ' ⚑ flat-fee pricing likely' : '';
            lines.push(`Lead Source: ${fd.lead_source}${flag}`);
          }
          // Sprint 1 Day 3 — coupon / discount (22 Apr ask).
          if (fd.coupon_code || (fd.discount_pct !== undefined && fd.discount_pct !== null && fd.discount_pct !== '')) {
            lines.push(`Coupon: ${val(fd.coupon_code)} | Discount: ${val(fd.discount_pct)}%`);
          }
          if (fd.insurance_status === 'insured') {
            lines.push(`Insurer: ${val(fd.insurer_name)} | Policy: ${val(fd.policy_member_id)}`);
            lines.push(`Coverage: ${currency(fd.insurance_coverage_amount)} | Co-pay: ${currency(fd.copay_patient_responsibility)}`);
          }
          if (fd.deposit_required) lines.push(`Deposit Required: ${currency(fd.deposit_required)}${fd.deposit_collected ? ' ✅ Collected: ' + currency(fd.deposit_collected_amount) : ''}`);

          lines.push('', `**Section C — Surgery Booking**`);
          lines.push(`Surgeon: ${val(fd.surgeon_name)} | Specialty: ${val(fd.surgical_specialty)}`);
          lines.push(`Procedure: ${val(fd.proposed_procedure)} | Urgency: ${val(fd.surgery_urgency)}`);
          if (fd.known_comorbidities && Array.isArray(fd.known_comorbidities) && fd.known_comorbidities.length > 0) {
            lines.push(`Co-morbidities: ${(fd.known_comorbidities as string[]).join(', ')} | Controlled: ${val(fd.comorbidities_controlled)}`);
          }
          if (fd.preferred_surgery_date) lines.push(`Surgery Date: ${fd.preferred_surgery_date} | Time: ${val(fd.preferred_surgery_time)}`);
          if (fd.anaesthesia_type) lines.push(`Anaesthesia: ${fd.anaesthesia_type}`);

          try {
            await sendSystemMessage('patient-thread', patient.getstream_channel_id, lines.join('\n'));
          } catch { /* non-fatal */ }
        }

        // ── 2. CC Department Channel — Financial counseling routing card ──
        {
          const ccLines: string[] = [
            `💰 **Financial Counseling Handoff** — ${pName} (UHID: ${pUhid})`,
            `Submitted by: ${submitterName}`,
            '',
            `Insurance: ${val(fd.insurance_status)}`,
          ];
          if (fd.insurance_status === 'insured') {
            ccLines.push(`Insurer: ${val(fd.insurer_name, 'CC to complete')}`);
            ccLines.push(`Policy/Member ID: ${val(fd.policy_member_id, 'CC to complete')}`);
            ccLines.push(`TPA Details: ${val(fd.insurance_tpa_details, 'CC to complete')}`);
            ccLines.push(`Coverage: ${currency(fd.insurance_coverage_amount)} | Co-pay: ${currency(fd.copay_patient_responsibility)}`);
          }
          // Sprint 1 Day 3 — lead source flag (Practo = flat-fee). Surfaced near top
          // so CC sees it before hitting the cost line.
          if (fd.lead_source) {
            const flag = fd.lead_source === 'practo' ? ' ⚑ flat-fee pricing likely' : '';
            ccLines.push(`Lead Source: ${fd.lead_source}${flag}`);
          }
          ccLines.push(`Package: ${val(fd.package_name, 'CC to complete')}`);
          // Sprint 1 Day 3 — room billing vs allocated (Niharika's 22 Apr ask).
          if (fd.billing_room_category || fd.allocated_room_category) {
            ccLines.push(`Billing Room: ${val(fd.billing_room_category)} | Allocated: ${val(fd.allocated_room_category)}`);
          }
          ccLines.push(`Est. Cost: ${currency(fd.estimated_total_cost)} | Payment: ${val(fd.payment_mode, 'CC to complete')}`);
          // Sprint 1 Day 3 — coupon / discount (22 Apr ask).
          if (fd.coupon_code || (fd.discount_pct !== undefined && fd.discount_pct !== null && fd.discount_pct !== '')) {
            ccLines.push(`Coupon: ${val(fd.coupon_code)} | Discount: ${val(fd.discount_pct)}%`);
          }
          ccLines.push(`Deposit Required: ${currency(fd.deposit_required)}${fd.deposit_collected ? ' ✅ Collected: ' + currency(fd.deposit_collected_amount) : ''}`);
          if (fd.patient_family_acknowledged) ccLines.push(`✅ Patient/family acknowledged costs`);
          if (fd.counselor_notes) ccLines.push(`Notes: ${fd.counselor_notes}`);
          // Sprint 1 Day 3 — surface attachments so CC can open insurance card / reports.
          if (Array.isArray(fd.attachments) && fd.attachments.length > 0) {
            const files = fd.attachments as Array<{ filename?: string }>;
            const names = files.slice(0, 3).map((f) => f.filename || 'file').join(', ');
            const extra = files.length > 3 ? ` +${files.length - 3} more` : '';
            ccLines.push(`📎 ${files.length} attachment${files.length === 1 ? '' : 's'}: ${names}${extra}`);
          }
          ccLines.push(``, `🔗 View patient thread for full context`);

          try {
            await sendSystemMessage('department', 'customer-care', ccLines.join('\n'));
          } catch {
            // Try alternate slug
            try { await sendSystemMessage('department', 'cc', ccLines.join('\n')); } catch { /* non-fatal */ }
          }
        }

        // ── 3. OT Department Channel — Surgery booking routing card ──
        {
          const otLines: string[] = [
            `🔪 **Surgery Booking Handoff** — ${pName} (UHID: ${pUhid})`,
            `Submitted by: ${submitterName}`,
            '',
            `Surgeon: ${val(fd.surgeon_name)} | Specialty: ${val(fd.surgical_specialty)}`,
            `Procedure: ${val(fd.proposed_procedure)}`,
            `Laterality: ${val(fd.laterality)} | Urgency: ${val(fd.surgery_urgency)}`,
          ];
          if (fd.clinical_justification) otLines.push(`Justification: ${fd.clinical_justification}`);
          if (fd.known_comorbidities && Array.isArray(fd.known_comorbidities) && fd.known_comorbidities.length > 0) {
            otLines.push(`Co-morbidities: ${(fd.known_comorbidities as string[]).join(', ')} | Controlled: ${val(fd.comorbidities_controlled)}`);
          }
          if (fd.habits && Array.isArray(fd.habits) && fd.habits.length > 0) {
            otLines.push(`Habits: ${(fd.habits as string[]).join(', ')}${fd.habits_stopped ? ' | Stopped 3+ days: ' + fd.habits_stopped : ''}`);
          }
          if (fd.current_medication) otLines.push(`Medication: ${fd.current_medication}`);
          otLines.push(`PAC: ${val(fd.pac_status, 'OT to complete')}`);
          otLines.push(`Surgery Date: ${val(fd.preferred_surgery_date, 'OT to schedule')} | Time: ${val(fd.preferred_surgery_time)}`);
          otLines.push(`Duration: ${val(fd.estimated_duration)} | Anaesthesia: ${val(fd.anaesthesia_type, 'Anaesthesia to confirm')}`);
          if (fd.support_requirements) otLines.push(`Support: ${fd.support_requirements}`);
          if (fd.special_requirements) otLines.push(`Special: ${fd.special_requirements}`);
          otLines.push(``, `🔗 View patient thread for full context`);

          try {
            await sendSystemMessage('department', 'ot', otLines.join('\n'));
          } catch {
            // Try alternate slug
            try { await sendSystemMessage('department', 'operation-theatre', otLines.join('\n')); } catch { /* non-fatal */ }
          }
        }

        // ── 4. Stage Transition: opd/pre_admission → admitted ──
        if (patient && (patient.current_stage === 'opd' || patient.current_stage === 'pre_admission')) {
          try {
            await sqlQuery(
              `UPDATE patient_threads
               SET current_stage = 'admitted',
                   admission_date = COALESCE(admission_date, NOW()),
                   updated_at = NOW()
               WHERE id = $1`,
              [body.patient_thread_id]
            );
            // Log the stage change
            await sqlQuery(
              `INSERT INTO escalation_log (patient_thread_id, source_type, source_id, escalated_from, escalated_to, reason, level)
               VALUES ($1, 'form_submission', $2, $3, 'admitted', 'Consolidated Marketing Handoff submitted', 'info')`,
              [body.patient_thread_id, formId, patient.current_stage]
            );
          } catch (err) {
            console.error('[ConsolidatedHandoff] Stage transition error:', err);
          }
        }
      } catch (err) {
        console.error('[ConsolidatedHandoff] Routing hook error:', err);
        // Non-fatal — form submission still succeeds
      }
    }

    // Post form card to GetStream channels
    const formLabel = FORM_TYPE_LABELS[form_type as FormType] || form_type;
    const formAttachment = {
      type: 'form_submission',
      form_id: formId,
      form_type: form_type,
      form_label: formLabel,
      status: 'submitted',
      submitted_by_name: user.email,
      completion_score: completionScore,
      readiness_items_created: readinessItemsCreated,
    };

    // Post dual activity message (patient thread + department) — always, not just when post_to_department is set
    if (status !== 'draft' && body.patient_thread_id) {
      // Look up patient name for the activity
      let patientName = 'Unknown';
      try {
        const ptRows = await sqlQuery<{ patient_name: string }>(
          `SELECT patient_name FROM patient_threads WHERE id = $1`,
          [body.patient_thread_id]
        );
        patientName = ptRows[0]?.patient_name || 'Unknown';
      } catch { /* non-fatal */ }

      await postPatientActivity({
        type: 'form_submitted',
        patientThreadId: body.patient_thread_id,
        patientName,
        patientChannelId: body.getstream_channel_id || null,
        actor: { profileId: user.profileId, name: user.email },
        data: {
          formLabel,
          formType: form_type,
          completionScore: completionScore,
          readinessItems: readinessItemsCreated,
        },
        attachment: formAttachment,
      });
    }

    
    // Fire-and-forget audit for form submission (only if not a draft)
    if (status !== 'draft') {
      await audit({
        actorId: user.profileId,
        actorRole: user.role,
        hospitalId: body.hospital_id || null,
        action: 'form.submit',
        targetType: 'form_submission',
        targetId: formId,
        summary: `Submitted ${form_type} form (${formId})`,
        payloadAfter: {
          form_type,
          form_submission_id: formId,
          patient_thread_id: body.patient_thread_id || null,
        },
        request,
      }).catch((e) => console.error('[audit] form.submit failed:', e));
    }

    // MH.7a — soft validation: if this is a marketing handoff with both an
    // admitting_doctor_id and target_hospital, check the affiliation. Mismatch
    // never blocks (per V's Q3) — appended to response.warnings + audited.
    const warnings: Array<{ code: string; message: string }> = [];
    if (
      form_type === 'consolidated_marketing_handoff' &&
      status !== 'draft' &&
      form_data.admitting_doctor_id &&
      form_data.target_hospital
    ) {
      try {
        const targetSlug = String(form_data.target_hospital).toLowerCase();
        const targetHospital = await queryOne<{ id: string }>(
          `SELECT id FROM hospitals WHERE slug = $1 LIMIT 1`,
          [targetSlug]
        );
        if (targetHospital?.id) {
          const v = await validateDoctorHospitalAffiliation(
            String(form_data.admitting_doctor_id),
            targetHospital.id
          );
          if (v.severity === 'warn' && v.message) {
            warnings.push({ code: 'doctor_hospital_mismatch', message: v.message });
            audit({
              actorId: user.profileId,
              actorRole: user.role,
              hospitalId: targetHospital.id,
              action: 'form.doctor_hospital_mismatch',
              targetType: 'form_submission',
              targetId: formId,
              summary: v.message,
              payloadAfter: {
                form_submission_id: formId,
                doctor_id: form_data.admitting_doctor_id,
                target_hospital_id: targetHospital.id,
                target_hospital_slug: targetSlug,
              },
              request,
            }).catch((e) => console.error('[audit] form.doctor_hospital_mismatch failed:', e));
          }
        }
      } catch (e) {
        console.warn('[forms] doctor-hospital validation skipped due to error:', (e as Error).message);
      }
    }

return NextResponse.json(
      {
        success: true,
        data: {
          id: formId,
          readiness_items_created: readinessItemsCreated,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
        message: status === 'draft'
          ? 'Draft saved'
          : `Form submitted with ${readinessItemsCreated} readiness item${readinessItemsCreated !== 1 ? 's' : ''}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit form' },
      { status: 500 }
    );
  }
}
