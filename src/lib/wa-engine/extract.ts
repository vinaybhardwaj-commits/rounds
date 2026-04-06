// ============================================
// WhatsApp Analysis Engine — Pass B: Extraction
// Phase: WA.3 (stub created in WA.1)
//
// Extracts structured data points per department.
// Runs in parallel across departments.
// ============================================

import type { ParsedWhatsAppMessage, ClassifiedMessage, ExtractionResult } from './types';

/**
 * Extract metrics from classified messages, per department.
 * Runs department extractions in parallel via Promise.all().
 * Stub — full implementation in WA.3.
 */
export async function extractByDepartment(
  _messages: ParsedWhatsAppMessage[],
  _classifications: ClassifiedMessage[]
): Promise<ExtractionResult[]> {
  // TODO: WA.3 — Implement extraction
  // 1. Group messages by department (from classifications)
  // 2. For each department with messages:
  //    a. Load department fields from wa_rubric
  //    b. Call Qwen with extraction prompt
  //    c. Parse structured response
  // 3. Run all departments in parallel
  throw new Error('WA.3 not yet implemented: extractByDepartment');
}
