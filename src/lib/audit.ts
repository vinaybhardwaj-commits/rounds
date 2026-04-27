// =============================================================================
// audit() — single canonical writer for the audit_log table (GLASS.2)
//
// Powers Glass mode: once clinical role gates come down, audit_log IS the
// safety net. Every state-mutating endpoint calls audit(...) AFTER the SQL
// mutation succeeds and BEFORE returning the response.
//
// Per PRD §5.2 (Daily Dash EHRC/GLASS-MODE-PRD.md, locked v1.0 26 Apr 2026).
//
// USAGE
//   import { audit } from '@/lib/audit';
//
//   // Most calls — fire-and-forget (default).
//   await audit({
//     actorId: user.profileId,
//     actorRole: user.role,
//     hospitalId: case.hospital_id,
//     action: 'case.transition',
//     targetType: 'surgical_case',
//     targetId: case.id,
//     summary: `Case ${case.id} transitioned ${oldState} → ${newState}`,
//     payloadBefore: { state: oldState },
//     payloadAfter: { state: newState },
//     request,
//   });
//
//   // The 6 Undo-allowlist actions (PRD §6.1) — guaranteed mode.
//   try {
//     await audit({ ..., action: 'patient.discharge', mode: 'guaranteed' });
//   } catch (auditErr) {
//     await reverseDischarge(...);  // rollback the mutation
//     return NextResponse.json({ success: false, error: 'Audit logging failed; mutation rolled back. Please retry.' }, { status: 503 });
//   }
//
// THREE KINDS OF ACCESS CHECKS (PRD §4 — critical to keep distinct):
//   - Role gates       → REMOVED in Glass (audit replaces)
//   - Identity gates   → KEEP (assignee_profile_id === user.profileId)
//   - Tenancy gates    → KEEP (user_accessible_hospital_ids())
//
// audit() does NOT enforce any of these — it only records what happened. The
// calling endpoint is still responsible for identity + tenancy checks.
// =============================================================================

import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';

export type AuditMode = 'fire_and_forget' | 'guaranteed';
export type AuditSource = 'api' | 'cron' | 'admin_console' | 'system';

// ── Config ──
// Cap any single payload at ~10KB stringified to keep rows manageable.
// Guaranteed-mode callers should pre-trim if they care about exact contents;
// fire-and-forget callers get truncation with a marker for visibility.
const MAX_PAYLOAD_BYTES = 10_000;
const UA_MAX_LENGTH = 200;

export interface AuditParams {
  actorId: string | null;
  actorRole: string | null;
  hospitalId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
  source?: AuditSource;
  request?: NextRequest;
  /**
   * 'fire_and_forget' (default): try/catch the INSERT; logger failures surface
   *   to console.error but DO NOT propagate. The user's mutation still
   *   returns 200. Used for high-frequency, low-impact actions.
   * 'guaranteed': INSERT failure THROWS — the calling endpoint should treat
   *   audit failure as mutation failure (catch + rollback the mutation, return
   *   503). Used for the 6 Undo allowlist actions where audit defensibility
   *   outweighs availability risk.
   */
  mode?: AuditMode;
}

/**
 * Stringify + truncate JSONB payload. Returns null for undefined input so the
 * column stays NULL (cleaner than storing literal "null").
 */
function preparePayload(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    // Cyclic refs etc — record the failure rather than crashing the writer.
    return JSON.stringify({ _audit_serialize_error: true, type: typeof value });
  }
  if (json.length > MAX_PAYLOAD_BYTES) {
    return JSON.stringify({
      _audit_truncated: true,
      original_bytes: json.length,
      preview: json.slice(0, 1000),
    });
  }
  return json;
}

/**
 * Pull audit-defensibility metadata from the request: IP from x-forwarded-for
 * (first hop), user-agent (truncated), and Vercel's request id for
 * cross-correlation with api_request_log.
 */
function extractRequestMeta(request?: NextRequest): {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
} {
  if (!request) return { ip: null, userAgent: null, requestId: null };
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null;
  const ua = request.headers.get('user-agent');
  const userAgent = ua ? ua.slice(0, UA_MAX_LENGTH) : null;
  const requestId = request.headers.get('x-vercel-id') || null;
  return { ip, userAgent, requestId };
}

/**
 * Record an audit_log row.
 *
 * Default mode is 'fire_and_forget' so safe for opportunistic wiring. Switch
 * to 'guaranteed' only for the PRD §6.1 Undo allowlist (6 actions). When in
 * guaranteed mode, the caller MUST handle the throw and rollback their
 * mutation accordingly — see PRD §5.2.1.
 */
export async function audit(params: AuditParams): Promise<void> {
  const mode: AuditMode = params.mode ?? 'fire_and_forget';
  const source: AuditSource = params.source ?? 'api';
  const { ip, userAgent, requestId } = extractRequestMeta(params.request);

  const payloadBeforeJson = preparePayload(params.payloadBefore);
  const payloadAfterJson = preparePayload(params.payloadAfter);

  try {
    await sql`
      INSERT INTO audit_log
        (actor_id, actor_role, hospital_id, action, target_type, target_id,
         summary, payload_before, payload_after, source, request_id, ip, user_agent)
      VALUES
        (${params.actorId},
         ${params.actorRole},
         ${params.hospitalId},
         ${params.action},
         ${params.targetType},
         ${params.targetId},
         ${params.summary},
         ${payloadBeforeJson}::jsonb,
         ${payloadAfterJson}::jsonb,
         ${source},
         ${requestId},
         ${ip},
         ${userAgent})
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mode === 'guaranteed') {
      // Rethrow — the calling endpoint is responsible for rollback + 503.
      // Tagged so callers can distinguish audit failures from mutation failures.
      console.error(`[audit:guaranteed] action=${params.action} target=${params.targetType}/${params.targetId} INSERT failed:`, msg);
      throw new Error(`Audit log write failed (guaranteed mode): ${msg}`);
    }
    // fire-and-forget: surface to console so we have visibility, but never
    // propagate — the user's mutation already succeeded and a logger glitch
    // shouldn't degrade their experience.
    console.error(`[audit:fire_and_forget] action=${params.action} target=${params.targetType}/${params.targetId} INSERT failed (swallowed):`, msg);
  }
}

/**
 * Convenience helper for the most common call shape: pass a JWTPayload (from
 * getCurrentUser) and the route's NextRequest, and the writer pulls actor
 * fields automatically. Reduces boilerplate at every wiring site.
 */
export async function auditFromUser(
  user: { profileId: string; role: string } | null,
  rest: Omit<AuditParams, 'actorId' | 'actorRole' | 'request'> & { request?: NextRequest }
): Promise<void> {
  return audit({
    ...rest,
    actorId: user?.profileId ?? null,
    actorRole: user?.role ?? null,
  });
}
