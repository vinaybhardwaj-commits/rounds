// ============================================
// POST /api/escalation/cron
// Periodic escalation check — finds overdue readiness items
// and escalates through the chain:
//   Level 0→1: Notify responsible person (DM or patient channel)
//   Level 1→2: Escalate to department head
//   Level 2→3: Escalate to on-duty staff
//   Level 3→4: Broadcast to ops (emergency-escalation channel)
//
// Designed to be called by Vercel Cron or external scheduler.
// Protected by CRON_SECRET env var OR super_admin auth.
// Step 5.3: Escalation Engine
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getOverdueReadinessItems,
  markReadinessItemEscalated,
  createEscalation,
  getCurrentOnDuty,
  getDepartmentHead,
} from '@/lib/db-v5';
import { sendSystemMessage } from '@/lib/getstream';

// How long (minutes) between re-escalation attempts for the same item
const RE_ESCALATION_COOLDOWN_MINUTES = 60;

export async function POST(request: NextRequest) {
  try {
    // Auth: either CRON_SECRET header or logged-in super_admin
    const cronSecret = request.headers.get('x-cron-secret');
    const envSecret = process.env.CRON_SECRET;

    let authorized = false;
    if (envSecret && cronSecret === envSecret) {
      authorized = true;
    } else {
      const user = await getCurrentUser();
      if (user?.role === 'super_admin') {
        authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all overdue readiness items
    const overdueItems = await getOverdueReadinessItems();

    if (!overdueItems || overdueItems.length === 0) {
      return NextResponse.json({
        success: true,
        data: { processed: 0, escalated: 0, skipped: 0 },
        message: 'No overdue items found',
      });
    }

    let escalated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of overdueItems) {
      try {
        // Check cooldown — don't re-escalate too frequently
        if (item.last_escalated_at) {
          const lastEsc = new Date(item.last_escalated_at).getTime();
          const cooldownMs = RE_ESCALATION_COOLDOWN_MINUTES * 60 * 1000;
          if (Date.now() - lastEsc < cooldownMs) {
            skipped++;
            continue;
          }
        }

        const currentLevel = item.escalation_level || 0;
        const nextLevel = currentLevel + 1;

        // Determine escalation target based on level
        const result = await escalateItem(item, nextLevel);

        if (result.sent) {
          // Mark item as escalated at new level
          await markReadinessItemEscalated(item.id, nextLevel);

          // Create escalation log entry
          await createEscalation({
            source_type: 'readiness_item',
            source_id: item.id,
            escalated_from: result.fromUserId || undefined,
            escalated_to: result.toUserId || undefined,
            patient_thread_id: item.patient_thread_id || undefined,
            getstream_channel_id: result.channelId || undefined,
            reason: result.reason,
            level: nextLevel,
          });

          escalated++;
        } else {
          skipped++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Item ${item.id}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        processed: overdueItems.length,
        escalated,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      },
      message: `Escalation run complete: ${escalated} escalated, ${skipped} skipped`,
    });
  } catch (error) {
    console.error('POST /api/escalation/cron error:', error);
    return NextResponse.json(
      { success: false, error: 'Escalation cron failed' },
      { status: 500 }
    );
  }
}

// ── Escalation Chain Logic ──

interface EscalationResult {
  sent: boolean;
  toUserId?: string;
  fromUserId?: string;
  channelId?: string;
  reason: string;
}

type OverdueItem = Awaited<ReturnType<typeof getOverdueReadinessItems>>[number];

async function escalateItem(
  item: OverdueItem,
  nextLevel: number
): Promise<EscalationResult> {
  const overdueMins = Math.round(
    (Date.now() - new Date(item.due_by).getTime()) / (1000 * 60)
  );
  const overdueStr = overdueMins >= 60
    ? `${Math.round(overdueMins / 60)}h ${overdueMins % 60}m`
    : `${overdueMins}m`;

  const itemLabel = `"${item.item_name}" (${item.form_type.replace(/_/g, ' ')})`;
  const patientStr = item.patient_name ? ` for patient ${item.patient_name}` : '';

  switch (nextLevel) {
    // ── Level 1: Notify in patient thread channel ──
    case 1: {
      const channelId = item.patient_thread_id
        ? `pt-${item.patient_thread_id.slice(0, 8)}`
        : null;

      if (channelId) {
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `⚠️ Overdue (${overdueStr}): ${itemLabel} — assigned to ${item.responsible_role?.replace(/_/g, ' ') || 'staff'}. Please complete ASAP.`
        );
      }

      return {
        sent: true,
        channelId: channelId || undefined,
        reason: `Level 1: Overdue ${overdueStr} — notified in patient channel`,
      };
    }

    // ── Level 2: Escalate to department head ──
    case 2: {
      let deptHeadId: string | null = null;

      if (item.department_id) {
        deptHeadId = await getDepartmentHead(item.department_id);
      }

      // Post to patient channel with escalation notice
      const channelId = item.patient_thread_id
        ? `pt-${item.patient_thread_id.slice(0, 8)}`
        : null;

      if (channelId) {
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `🔺 Escalation (Level 2): ${itemLabel}${patientStr} is overdue by ${overdueStr}. Escalated to department head.`
        );
      }

      return {
        sent: true,
        toUserId: deptHeadId || undefined,
        channelId: channelId || undefined,
        reason: `Level 2: Escalated to department head — overdue ${overdueStr}`,
      };
    }

    // ── Level 3: Escalate to on-duty staff ──
    case 3: {
      let onDutyUserId: string | null = null;

      if (item.department_id && item.responsible_role) {
        const onDuty = await getCurrentOnDuty(item.department_id, item.responsible_role);
        onDutyUserId = onDuty?.user_id || null;
      }

      const channelId = item.patient_thread_id
        ? `pt-${item.patient_thread_id.slice(0, 8)}`
        : null;

      if (channelId) {
        const onDutyMsg = onDutyUserId
          ? 'Escalated to on-duty staff.'
          : 'No on-duty staff found — requires manual attention.';
        await sendSystemMessage(
          'patient-thread',
          channelId,
          `🚨 Escalation (Level 3): ${itemLabel}${patientStr} is overdue by ${overdueStr}. ${onDutyMsg}`
        );
      }

      return {
        sent: true,
        toUserId: onDutyUserId || undefined,
        channelId: channelId || undefined,
        reason: `Level 3: Escalated to on-duty — overdue ${overdueStr}`,
      };
    }

    // ── Level 4+: Broadcast to emergency-escalation channel ──
    default: {
      await sendSystemMessage(
        'cross-functional',
        'emergency-escalation',
        `🚨🚨 CRITICAL ESCALATION (Level ${nextLevel}): ${itemLabel}${patientStr} has been overdue for ${overdueStr}. All previous escalation levels exhausted. Immediate attention required.`
      );

      return {
        sent: true,
        channelId: 'emergency-escalation',
        reason: `Level ${nextLevel}: Broadcast to emergency-escalation — overdue ${overdueStr}`,
      };
    }
  }
}
