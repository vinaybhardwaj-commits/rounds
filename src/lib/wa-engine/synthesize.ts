// ============================================
// WhatsApp Analysis Engine — Pass C: Synthesis
// Phase: WA.3 (stub created in WA.1)
//
// Produces final summary, flags global issues,
// and proposes rubric improvements (WA.4).
// ============================================

import type { ExtractionResult, SynthesisResult } from './types';

/**
 * Synthesize extraction results into summary + global flags + rubric proposals.
 * Stub — full implementation in WA.3 (synthesis + flags), WA.4 (rubric evolution).
 */
export async function synthesizeResults(
  _extractions: ExtractionResult[],
  _sourceGroup: string
): Promise<SynthesisResult> {
  // TODO: WA.3 — Implement synthesis + global issues
  // TODO: WA.4 — Add rubric evolution proposals
  // 1. Load global issues definitions from wa_rubric
  // 2. Match extracted data against issue triggers
  // 3. Produce summary statistics
  // 4. (WA.4) Analyze unattributed messages for rubric gaps
  throw new Error('WA.3 not yet implemented: synthesizeResults');
}
