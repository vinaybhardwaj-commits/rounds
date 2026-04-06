// ============================================
// WhatsApp Analysis Engine — Deduplication
// Phase: WA.2
//
// SHA-256 fingerprinting + bulk hash check against
// wa_message_hashes table. Returns only new messages.
// ============================================

import { neon } from '@neondatabase/serverless';
import type { ParsedWhatsAppMessage } from './types';

function getSql() {
  return neon(process.env.POSTGRES_URL!);
}

/**
 * Check parsed messages against the dedup registry.
 * Returns only messages not previously processed.
 *
 * Performs a bulk SELECT on wa_message_hashes to find which
 * hashes already exist, then returns the delta.
 */
export async function deduplicateMessages(
  messages: ParsedWhatsAppMessage[],
): Promise<{ newMessages: ParsedWhatsAppMessage[]; duplicateCount: number }> {
  // Filter out system messages first — they're never analyzed
  const userMessages = messages.filter(m => !m.is_system_message);

  if (userMessages.length === 0) {
    return { newMessages: [], duplicateCount: 0 };
  }

  const sql = getSql();
  const allHashes = userMessages.map(m => m.hash);

  // Bulk check in batches of 500 (Neon has parameter limits)
  const existingHashes = new Set<string>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < allHashes.length; i += BATCH_SIZE) {
    const batch = allHashes.slice(i, i + BATCH_SIZE);
    // Use ANY($1::text[]) for efficient bulk lookup
    const rows = await sql(
      'SELECT hash FROM wa_message_hashes WHERE hash = ANY($1::text[])',
      [batch]
    ) as { hash: string }[];
    for (const row of rows) {
      existingHashes.add(row.hash);
    }
  }

  const newMessages = userMessages.filter(m => !existingHashes.has(m.hash));
  const duplicateCount = userMessages.length - newMessages.length;

  return { newMessages, duplicateCount };
}

/**
 * Record processed message hashes after successful analysis.
 * Only called AFTER analysis completes (not before — so retries work).
 *
 * Inserts hashes in batches. Uses ON CONFLICT DO NOTHING for safety
 * (if hash was inserted by a concurrent analysis, skip it).
 */
export async function recordProcessedHashes(
  messages: ParsedWhatsAppMessage[],
  analysisId: string,
): Promise<void> {
  if (messages.length === 0) return;

  const sql = getSql();
  const BATCH_SIZE = 100;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    // Build a multi-row INSERT using parameterized values
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const m = batch[j];
      const offset = j * 5;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::timestamptz, $${offset + 5})`
      );
      values.push(
        m.hash,
        m.group_name,
        m.sender,
        m.timestamp.toISOString(),
        analysisId,
      );
    }

    await sql(
      `INSERT INTO wa_message_hashes (hash, source_group, source_sender, message_timestamp, first_analysis_id)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (hash) DO NOTHING`,
      values,
    );
  }
}
