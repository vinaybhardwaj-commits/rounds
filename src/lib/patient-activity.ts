// ============================================
// Patient Activity — Dual-Post System
//
// Every meaningful patient change posts a message
// to TWO channels:
//   1. The patient's own thread (detailed)
//   2. The acting user's department chat (summary)
//
// This gives per-patient traceability AND a
// department-level activity feed.
// ============================================

import { sendSystemMessage } from './getstream';
import { query, queryOne } from './db';

// ============================================
// TYPES
// ============================================

export type ActivityType =
  | 'stage_change'
  | 'form_submitted'
  | 'patient_archived'
  | 'patient_restored'
  | 'patient_created'
  | 'patient_imported'       // LSQ sync
  | 'bed_assigned'
  | 'consultant_changed'
  | 'department_changed'
  | 'readiness_completed';

export interface ActivityEvent {
  type: ActivityType;
  patientThreadId: string;
  patientName: string;
  /** GetStream channel ID for the patient thread (e.g., pt-abc12345) */
  patientChannelId: string | null;
  /** The user who performed the action */
  actor: {
    profileId: string;
    name: string;            // email or full_name
  };
  /** Event-specific payload */
  data: Record<string, unknown>;
  /** Optional GetStream attachment (e.g., form cards) */
  attachment?: Record<string, unknown>;
}

// ============================================
// MESSAGE FORMATTERS
//
// Each event type has two formatters:
//   - patientMessage: detailed, for the patient thread
//   - deptMessage: compact one-liner for department feed
// ============================================

interface FormattedMessages {
  patientMessage: string;
  deptMessage: string;
}

function formatActivity(event: ActivityEvent): FormattedMessages {
  const { type, patientName, actor, data } = event;
  const byLine = actor.name;

  switch (type) {
    case 'stage_change': {
      const from = data.fromLabel as string;
      const to = data.toLabel as string;
      const extra = data.membersAdded ? `. ${data.membersAdded} staff added.` : '';
      return {
        patientMessage: `📍 Stage: ${from} → ${to}${extra} — by ${byLine}`,
        deptMessage: `📍 ${patientName} → ${to} — ${byLine}`,
      };
    }

    case 'form_submitted': {
      const formLabel = data.formLabel as string;
      const score = data.completionScore as number | null;
      const items = data.readinessItems as number;
      const scoreStr = score !== null && score !== undefined ? ` (${score}%)` : '';
      const itemStr = items > 0 ? `, ${items} readiness item${items !== 1 ? 's' : ''}` : '';
      return {
        patientMessage: `📋 ${formLabel} submitted${scoreStr}${itemStr} — by ${byLine}`,
        deptMessage: `📋 ${formLabel} for ${patientName} — ${byLine}`,
      };
    }

    case 'patient_archived': {
      const archiveType = data.archiveType as string;
      const reason = data.reasonLabel as string | null;
      if (archiveType === 'post_discharge') {
        return {
          patientMessage: `📦 Moved to post-discharge archive — by ${byLine}`,
          deptMessage: `📦 ${patientName} archived (post-discharge) — ${byLine}`,
        };
      }
      return {
        patientMessage: `🗑️ Removed: ${reason || 'No reason'}${data.reasonDetail ? ` — ${data.reasonDetail}` : ''} — by ${byLine}`,
        deptMessage: `🗑️ ${patientName} removed: ${reason || 'No reason'} — ${byLine}`,
      };
    }

    case 'patient_restored': {
      return {
        patientMessage: `♻️ Restored to active list — by ${byLine}`,
        deptMessage: `♻️ ${patientName} restored to active list — ${byLine}`,
      };
    }

    case 'patient_created': {
      const stage = data.stageLabel as string;
      return {
        patientMessage: `🆕 Patient thread created. Stage: ${stage} — by ${byLine}`,
        deptMessage: `🆕 ${patientName} added (${stage}) — ${byLine}`,
      };
    }

    case 'patient_imported': {
      const stage = data.stageLabel as string;
      const ailment = data.ailment as string | null;
      const ailmentStr = ailment ? ` · ${ailment}` : '';
      return {
        patientMessage: `🔗 Imported from LeadSquared. Stage: ${stage}${ailmentStr}`,
        deptMessage: `🔗 New LSQ patient: ${patientName} (${stage}${ailmentStr})`,
      };
    }

    case 'bed_assigned': {
      const bed = data.bedNumber as string;
      const floor = data.floorInfo as string | null;
      const floorStr = floor ? ` · ${floor}` : '';
      return {
        patientMessage: `🛏️ Bed assigned: ${bed}${floorStr} — by ${byLine}`,
        deptMessage: `🛏️ ${patientName} → Bed ${bed}${floorStr} — ${byLine}`,
      };
    }

    case 'consultant_changed': {
      const from = data.fromName as string | null;
      const to = data.toName as string;
      return {
        patientMessage: `👨‍⚕️ Primary consultant: ${from ? `${from} → ` : ''}${to} — by ${byLine}`,
        deptMessage: `👨‍⚕️ ${patientName} consultant → ${to} — ${byLine}`,
      };
    }

    case 'department_changed': {
      const from = data.fromDeptName as string | null;
      const to = data.toDeptName as string;
      return {
        patientMessage: `🏥 Department: ${from ? `${from} → ` : ''}${to} — by ${byLine}`,
        deptMessage: `🏥 ${patientName} transferred to ${to} — ${byLine}`,
      };
    }

    case 'readiness_completed': {
      const itemName = data.itemName as string;
      return {
        patientMessage: `✅ ${itemName} completed — by ${byLine}`,
        deptMessage: `✅ ${itemName} for ${patientName} — ${byLine}`,
      };
    }

    default:
      return {
        patientMessage: `Activity: ${type} — by ${byLine}`,
        deptMessage: `${patientName}: ${type} — ${byLine}`,
      };
  }
}

// ============================================
// DEPARTMENT LOOKUP (cached per request)
// ============================================

/**
 * Look up a user's department slug from their profile ID.
 * Returns null if the user has no department.
 */
async function getDepartmentSlugForUser(profileId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ slug: string }>(
      `SELECT d.slug FROM profiles p
       JOIN departments d ON d.id = p.department_id
       WHERE p.id = $1`,
      [profileId]
    );
    return row?.slug || null;
  } catch {
    return null;
  }
}

/**
 * Look up department slug for a patient thread (from the patient's department).
 * Falls back to the actor's department if patient has no department.
 */
async function getDepartmentSlugForPatient(patientThreadId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ slug: string }>(
      `SELECT d.slug FROM patient_threads pt
       JOIN departments d ON d.id = pt.department_id
       WHERE pt.id = $1`,
      [patientThreadId]
    );
    return row?.slug || null;
  } catch {
    return null;
  }
}

// ============================================
// MAIN: postPatientActivity
// ============================================

/**
 * Post a patient activity to both the patient's thread and the
 * department channel. Non-blocking — failures are logged but
 * never propagate to the caller.
 *
 * Usage:
 *   await postPatientActivity({
 *     type: 'stage_change',
 *     patientThreadId: id,
 *     patientName: 'Pranav Sunil Deshmukh',
 *     patientChannelId: 'pt-abc12345',
 *     actor: { profileId: user.profileId, name: user.email },
 *     data: { fromLabel: 'Pre-Admission', toLabel: 'Admitted', membersAdded: 3 },
 *   });
 */
export async function postPatientActivity(event: ActivityEvent): Promise<void> {
  try {
    const { patientMessage, deptMessage } = formatActivity(event);

    // 1. Post to patient's own thread
    if (event.patientChannelId) {
      try {
        await sendSystemMessage(
          'patient-thread',
          event.patientChannelId,
          patientMessage,
          event.attachment ? { attachments: [event.attachment] } : undefined
        );
      } catch (err) {
        console.error(`[Activity] Failed to post to patient channel ${event.patientChannelId}:`, err);
      }
    }

    // 2. Post to actor's department channel
    // Try patient's department first, fall back to actor's department
    let deptSlug = await getDepartmentSlugForPatient(event.patientThreadId);
    if (!deptSlug) {
      deptSlug = await getDepartmentSlugForUser(event.actor.profileId);
    }

    if (deptSlug) {
      try {
        await sendSystemMessage(
          'department',
          deptSlug,
          deptMessage,
          event.attachment ? { attachments: [event.attachment] } : undefined
        );
      } catch (err) {
        console.error(`[Activity] Failed to post to department ${deptSlug}:`, err);
      }
    }

    // 3. Special case: department transfer → also notify the OLD department
    if (event.type === 'department_changed' && event.data.fromDeptSlug) {
      try {
        const oldDeptSlug = event.data.fromDeptSlug as string;
        await sendSystemMessage(
          'department',
          oldDeptSlug,
          `↗️ ${event.patientName} transferred out to ${event.data.toDeptName} — ${event.actor.name}`
        );
      } catch (err) {
        console.error(`[Activity] Failed to post transfer-out to old department:`, err);
      }
    }
  } catch (err) {
    // Never let activity posting break the calling operation
    console.error('[Activity] postPatientActivity failed:', err);
  }
}
