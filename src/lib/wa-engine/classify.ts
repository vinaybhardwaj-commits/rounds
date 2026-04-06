// ============================================
// WhatsApp Analysis Engine — Pass A: Classification
// Phase: WA.3 (stub created in WA.1)
//
// Classifies messages by department using the
// keyword registry from wa_rubric. Batched ~80 msgs/call.
// ============================================

import type { ParsedWhatsAppMessage, ClassifiedMessage } from './types';

/**
 * Classify messages by department using LLM + keyword registry.
 * Stub — full implementation in WA.3.
 */
export async function classifyMessages(
  _messages: ParsedWhatsAppMessage[]
): Promise<ClassifiedMessage[]> {
  // TODO: WA.3 — Implement classification
  // 1. Load department keywords from wa_rubric
  // 2. Batch messages (~80 per LLM call)
  // 3. Call Qwen with classification prompt
  // 4. Merge results across batches
  throw new Error('WA.3 not yet implemented: classifyMessages');
}
