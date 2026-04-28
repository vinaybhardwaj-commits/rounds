// =============================================================================
// sync-patient-channel-metadata.ts (PTR.1 — 28 Apr 2026)
//
// Stamps `current_stage` + `hospital_slug` onto a patient-thread GetStream
// channel's custom data so ChannelSidebar can group it (PTR.3) into:
//   OPD / Pre-Admission / {hospital} · Admitted / {hospital} · Post-Care
//
// Called from:
//   - patient-create paths (PTR.1: /api/patients POST, /api/patients/import,
//     /api/forms when handoff creates a patient_thread)
//   - stage-transition endpoints (PTR.2: ~8 sites)
//   - admin edits that change hospital_id (PTR.2: /admin/profiles, /admin/dedup)
//   - one-shot backfill for the 414 existing channels (PTR.1c endpoint)
//
// Idempotent + NON-throwing. Failures log + continue (per PRD §10 risk
// mitigation: 'Stage transitions might fire but channel.data update silently
// fail — wrap in try/catch + log; daily reconciliation cron as backup').
// =============================================================================

import { queryOne } from '@/lib/db';
import { updatePatientChannel } from '@/lib/getstream';

interface PatientChannelMetadata {
  current_stage: string;
  hospital_slug: string | null;
  hospital_id: string | null;
  getstream_channel_id: string | null;
}

/**
 * Read current state from DB + push update to GetStream channel.
 * Returns true on success, false on any failure (does not throw).
 */
export async function syncPatientChannelMetadata(patientThreadId: string): Promise<boolean> {
  if (!patientThreadId) return false;

  let meta: PatientChannelMetadata | null = null;
  try {
    meta = await queryOne<PatientChannelMetadata>(
      `SELECT pt.current_stage, h.slug AS hospital_slug, pt.hospital_id::text AS hospital_id,
              pt.getstream_channel_id
       FROM patient_threads pt
       LEFT JOIN hospitals h ON h.id = pt.hospital_id
       WHERE pt.id = $1::uuid`,
      [patientThreadId]
    );
  } catch (err) {
    console.error('[syncPatientChannelMetadata] DB read failed', { patientThreadId, err });
    return false;
  }

  if (!meta) {
    console.warn('[syncPatientChannelMetadata] patient_thread not found', patientThreadId);
    return false;
  }

  // Prefer the actual stored channel_id (some legacy threads pre-date the
  // pt-{first8} convention); fall back to convention only as last resort.
  const channelId = meta.getstream_channel_id || `pt-${patientThreadId.slice(0, 8)}`;
  if (!meta.getstream_channel_id) {
    // Likely no channel exists at all — skip silently rather than try to update
    // a channel that doesn't exist (would 404 from GetStream API).
    console.info('[syncPatientChannelMetadata] no getstream_channel_id', patientThreadId);
    return false;
  }

  try {
    await updatePatientChannel(channelId, {
      current_stage: meta.current_stage,
      hospital_slug: meta.hospital_slug,
      hospital_id: meta.hospital_id,
    });
    return true;
  } catch (err) {
    console.error('[syncPatientChannelMetadata] GetStream update failed', { patientThreadId, channelId, err });
    return false;
  }
}
