// ============================================
// POST /api/ot-lists/lock
//
// Rajeshwari's 9:30 PM one-click lock for the next-day OT list. Writes a
// final_930pm row (partial unique idx_olv_one_final_per_day enforces one per
// hospital/date), composes the WhatsApp dispatch text, and either sends via
// Twilio if credentials are present, or returns the text for manual paste.
//
// Body:
//   {
//     hospital_slug: 'ehrc' | 'ehbr' | 'ehin',
//     list_date: 'YYYY-MM-DD',          // defaults to tomorrow in IST
//     recipients?: string[]             // optional WhatsApp numbers; else falls back to env WHATSAPP_OT_DISPATCH_TO (comma-separated)
//   }
//
// Access: ot_coordinator | super_admin
// Tenancy: user_accessible_hospital_ids(caller)
//
// Sprint 3 Day 12 (24 April 2026). Behind FEATURE_CASE_MODEL_ENABLED.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const LOCK_ROLES = new Set(['ot_coordinator', 'super_admin']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface HospitalRow {
  id: string;
  slug: string;
  name: string;
}

interface CaseRow {
  id: string;
  patient_name: string | null;
  planned_procedure: string | null;
  ot_room: number | null;
  urgency: string | null;
  state: string;
  surgeon_id: string | null;
  anaesthetist_id: string | null;
}

interface LockBody {
  hospital_slug?: string;
  list_date?: string;
  recipients?: string[];
}

function composeMessage(
  hospital: HospitalRow,
  listDate: string,
  cases: CaseRow[]
): string {
  const lines: string[] = [];
  lines.push(`🏥 *${hospital.name} — OT List for ${listDate}*`);
  lines.push(`Locked ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  lines.push('');
  if (cases.length === 0) {
    lines.push('_No cases scheduled._');
  } else {
    const byRoom: Record<string, CaseRow[]> = {};
    for (const c of cases) {
      const room = c.ot_room ? `OT-${c.ot_room}` : 'Unassigned';
      if (!byRoom[room]) byRoom[room] = [];
      byRoom[room].push(c);
    }
    for (const room of Object.keys(byRoom).sort()) {
      lines.push(`*${room}*`);
      byRoom[room].forEach((c, i) => {
        const urgency = c.urgency === 'emergency' ? ' 🚨' : c.urgency === 'urgent' ? ' ⚠️' : '';
        lines.push(`${i + 1}. ${c.patient_name ?? '(no name)'}${urgency} — ${c.planned_procedure ?? 'TBD'}`);
      });
      lines.push('');
    }
  }
  lines.push(`_Total: ${cases.length} case(s). Full detail on the Rounds OT Calendar._`);
  return lines.join('\n');
}

async function dispatchViaTwilio(
  recipients: string[],
  messageBody: string
): Promise<{ ok: boolean; sent: number; errors: string[] }> {
  const sid = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+14782238252'
  if (!sid || !token || !from) {
    return { ok: false, sent: 0, errors: ['Twilio env vars missing (TWILIO_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)'] };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const errors: string[] = [];
  let sent = 0;

  for (const r of recipients) {
    const to = r.startsWith('whatsapp:') ? r : `whatsapp:${r}`;
    const form = new URLSearchParams({ From: from, To: to, Body: messageBody });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (res.ok) {
        sent += 1;
      } else {
        const txt = await res.text();
        errors.push(`${to}: HTTP ${res.status} ${txt.slice(0, 120)}`);
      }
    } catch (e) {
      errors.push(`${to}: ${(e as Error).message}`);
    }
  }
  return { ok: errors.length === 0, sent, errors };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (process.env.FEATURE_CASE_MODEL_ENABLED !== 'true') {
      return NextResponse.json({ success: false, error: 'Case model disabled' }, { status: 503 });
    }

    if (!LOCK_ROLES.has(user.role)) {
      return NextResponse.json(
        { success: false, error: `Role ${user.role} cannot lock OT list. Required: ${[...LOCK_ROLES].join(' or ')}.` },
        { status: 403 }
      );
    }

    const body = (await request.json()) as LockBody;
    if (!body.hospital_slug || typeof body.hospital_slug !== 'string') {
      return NextResponse.json({ success: false, error: 'hospital_slug required' }, { status: 400 });
    }
    // list_date default: tomorrow in IST.
    let listDate = body.list_date;
    if (!listDate) {
      const r = await query<{ d: string }>(
        `SELECT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date + INTERVAL '1 day')::date::text AS d`,
        []
      );
      listDate = r[0]?.d;
    }
    if (!listDate || !DATE_RE.test(listDate)) {
      return NextResponse.json({ success: false, error: 'list_date must be YYYY-MM-DD' }, { status: 400 });
    }

    // Resolve hospital + tenancy.
    const hospital = await queryOne<HospitalRow>(
      `
      SELECT h.id, h.slug, h.name
      FROM hospitals h
      WHERE h.slug = $1
        AND h.id = ANY(user_accessible_hospital_ids($2::UUID))
        AND h.is_active = true
      `,
      [body.hospital_slug, user.profileId]
    );
    if (!hospital) {
      return NextResponse.json({ success: false, error: 'Hospital not found or access denied' }, { status: 404 });
    }

    // Pull the cases for this hospital+date.
    const cases = await query<CaseRow>(
      `
      SELECT sc.id, pt.patient_name, sc.planned_procedure, sc.ot_room, sc.urgency, sc.state,
             sc.surgeon_id, sc.anaesthetist_id
      FROM surgical_cases sc
      LEFT JOIN patient_threads pt ON pt.id = sc.patient_thread_id
      WHERE sc.hospital_id = $1
        AND sc.planned_surgery_date = $2::date
        AND sc.state IN ('scheduled', 'confirmed', 'verified')
        AND sc.archived_at IS NULL
      ORDER BY sc.ot_room NULLS LAST, sc.created_at ASC
      `,
      [hospital.id, listDate]
    );

    // Already locked? Partial unique idx_olv_one_final_per_day enforces this at DB level too,
    // but check first to return a clean 409.
    const existing = await queryOne<{ id: string; dispatched_at: string | null }>(
      `
      SELECT id, dispatched_at FROM ot_list_versions
      WHERE hospital_id = $1 AND list_date = $2::date AND version_type = 'final_930pm'
      `,
      [hospital.id, listDate]
    );
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'OT list already locked for this hospital + date',
          existing: { id: existing.id, dispatched_at: existing.dispatched_at },
        },
        { status: 409 }
      );
    }

    const caseIds = cases.map((c) => c.id);
    const payload = {
      hospital: { id: hospital.id, slug: hospital.slug, name: hospital.name },
      list_date: listDate,
      locked_at: new Date().toISOString(),
      locked_by: user.profileId,
      cases: cases.map((c) => ({
        id: c.id,
        patient_name: c.patient_name,
        procedure: c.planned_procedure,
        ot_room: c.ot_room,
        urgency: c.urgency,
        state: c.state,
      })),
    };

    // Insert the final_930pm row. Partial unique idx will reject duplicates at DB level
    // if our pre-check missed a race. Fine — clean 23505 → we convert to 409 below.
    let versionId: string;
    try {
      const inserted = await query<{ id: string }>(
        `
        INSERT INTO ot_list_versions (hospital_id, list_date, version_type, case_ids, snapshot_payload, locked_by)
        VALUES ($1, $2::date, 'final_930pm', $3::uuid[], $4::jsonb, $5)
        RETURNING id
        `,
        [hospital.id, listDate, caseIds, JSON.stringify(payload), user.profileId]
      );
      versionId = inserted[0]?.id ?? '';
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('idx_olv_one_final_per_day') || msg.includes('duplicate key')) {
        return NextResponse.json({ success: false, error: 'Already locked (race)' }, { status: 409 });
      }
      throw e;
    }

    // Compose the WhatsApp message text.
    const messageText = composeMessage(hospital, listDate, cases);

    // Resolve recipients: body list preferred, else env var.
    const envRecipients = (process.env.WHATSAPP_OT_DISPATCH_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const recipients = (body.recipients && body.recipients.length > 0) ? body.recipients : envRecipients;

    let dispatchResult: { ok: boolean; sent: number; errors: string[] } | null = null;
    if (recipients.length > 0) {
      dispatchResult = await dispatchViaTwilio(recipients, messageText);
      if (dispatchResult.ok && dispatchResult.sent > 0) {
        await query(
          `UPDATE ot_list_versions SET dispatched_at = NOW() WHERE id = $1`,
          [versionId]
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        version_id: versionId,
        hospital_slug: hospital.slug,
        list_date: listDate,
        case_count: cases.length,
        message_text: messageText,
        dispatch: dispatchResult
          ? { attempted: true, ...dispatchResult }
          : { attempted: false, reason: 'no recipients — copy message_text for manual paste' },
      },
    });
  } catch (error) {
    console.error('POST /api/ot-lists/lock error:', error);
    return NextResponse.json(
      { success: false, error: 'Lock failed', detail: (error as Error).message },
      { status: 500 }
    );
  }
}
