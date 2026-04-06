// ============================================
// WhatsApp Analysis Engine — Deduplication
// Phase: WA.2 (stub created in WA.1)
//
// SHA-256 fingerprinting + bulk hash check against
// wa_message_hashes table. Returns only new messages.
// ============================================

import type { ParsedWhatsAppMessage } from './types';

/**
 * Check parsed messages against the dedup registry.
 * Returns only messages not previously processed.
 * Stub — full implementation in WA.2.
 */
export async function deduplicateMessages(
  _messages: ParsedWhatsAppMessage[]
): Promise<{ newMessages: ParsedWhatsAppMessage[]; duplicateCount: number }> {
  // TODO: WA.2 — Implement dedup
  // 1. Collect all hashes from messages
  // 2. Bulk check against wa_message_hashes
  // 3. Return delta (new only) + duplicate count
  throw new Error('WA.2 not yet implemented: deduplicateMessages');
}

/**
 * Record processed message hashes after successful analysis.
 * Only called AFTER analysis completes (not before — so retries work).
 */
export async function recordProcessedHashes(
  _messages: ParsedWhatsAppMessage[],
  _analysisId: string
): Promise<void> {
  // TODO: WA.2 — Implement hash recording
  throw new Error('WA.2 not yet implemented: recordProcessedHashes');
}
