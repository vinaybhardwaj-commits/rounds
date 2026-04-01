// ============================================
// LSQ API Call Logger
// Records every HTTP request/response to
// LeadSquared for full traceability.
// ============================================

import { query, queryOne } from './db';

export interface ApiCallLog {
  endpoint: string;
  method: string;
  requestBody?: unknown;
  responseStatus: number;
  responseBody?: unknown;
  errorMessage?: string;
  durationMs: number;
  syncRunId?: string;      // FK to lsq_sync_log.id
  leadId?: string;         // Which lead this call was about
  callType: 'get_lead' | 'search_leads' | 'get_activities' | 'webhook_receive' | 'other';
}

/**
 * Log a single API call to the lsq_api_log table.
 * Non-blocking — failures are silently caught to avoid
 * disrupting sync operations.
 */
export async function logApiCall(entry: ApiCallLog): Promise<string | null> {
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO lsq_api_log (
        endpoint, method, request_body,
        response_status, response_body, error_message,
        duration_ms, sync_run_id, lead_id, call_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        entry.endpoint,
        entry.method,
        entry.requestBody ? JSON.stringify(entry.requestBody) : null,
        entry.responseStatus,
        entry.responseBody ? JSON.stringify(
          typeof entry.responseBody === 'string'
            ? entry.responseBody
            : entry.responseBody
        ) : null,
        entry.errorMessage || null,
        entry.durationMs,
        entry.syncRunId || null,
        entry.leadId || null,
        entry.callType,
      ]
    );
    return row?.id || null;
  } catch (error) {
    console.error('[LSQ API Log] Failed to log API call:', error);
    return null;
  }
}

/**
 * Fetch recent API call logs for the admin panel.
 */
export async function getApiCallLogs(options?: {
  limit?: number;
  offset?: number;
  syncRunId?: string;
  callType?: string;
  onlyErrors?: boolean;
}): Promise<{ logs: ApiCallLogRow[]; total: number }> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options?.syncRunId) {
    conditions.push(`sync_run_id = $${paramIndex++}`);
    params.push(options.syncRunId);
  }
  if (options?.callType) {
    conditions.push(`call_type = $${paramIndex++}`);
    params.push(options.callType);
  }
  if (options?.onlyErrors) {
    conditions.push(`(response_status >= 400 OR error_message IS NOT NULL)`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM lsq_api_log ${whereClause}`,
    params
  );

  const logs = await query<ApiCallLogRow>(
    `SELECT id, endpoint, method, request_body, response_status,
            response_body, error_message, duration_ms,
            sync_run_id, lead_id, call_type, created_at
     FROM lsq_api_log ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return {
    logs: logs as ApiCallLogRow[],
    total: parseInt(countResult?.count || '0', 10),
  };
}

export interface ApiCallLogRow {
  id: string;
  endpoint: string;
  method: string;
  request_body: string | null;
  response_status: number;
  response_body: string | null;
  error_message: string | null;
  duration_ms: number;
  sync_run_id: string | null;
  lead_id: string | null;
  call_type: string;
  created_at: string;
}

/**
 * Fetch sync run logs for the admin panel.
 */
export async function getSyncLogs(options?: {
  limit?: number;
  offset?: number;
}): Promise<{ logs: SyncLogRow[]; total: number }> {
  const limit = options?.limit || 30;
  const offset = options?.offset || 0;

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM lsq_sync_log`
  );

  const logs = await query<SyncLogRow>(
    `SELECT id, sync_type, trigger_stage,
            leads_found, leads_created, leads_updated, leads_skipped,
            errors, started_at, completed_at, duration_ms
     FROM lsq_sync_log
     ORDER BY started_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    logs: logs as SyncLogRow[],
    total: parseInt(countResult?.count || '0', 10),
  };
}

export interface SyncLogRow {
  id: string;
  sync_type: string;
  trigger_stage: string | null;
  leads_found: number;
  leads_created: number;
  leads_updated: number;
  leads_skipped: number;
  errors: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}
