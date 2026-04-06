// ============================================
// WhatsApp Analysis Engine — Type Definitions
// Phase: WA.1 (Foundation)
// ============================================

// ── Rubric Types ──

export interface RubricField {
  label: string;
  type: 'number' | 'text';
  extraction_hint: string;
  is_signature_kpi: boolean;
  added_by: 'seed' | 'evolution';
  added_at: string;
  proposal_id?: string;
}

export interface GlobalIssueDefinition {
  issue_id: string;
  label: string;
  source_dept: string;
  description: string;
}

export interface GlobalIssuesConfig {
  critical: GlobalIssueDefinition[];
  warnings: GlobalIssueDefinition[];
}

export interface WARubric {
  id: string;
  slug: string;
  name: string;
  version: number;
  keywords: string[];
  fields: RubricField[];
  global_issues: GlobalIssuesConfig | null;
  sender_authority: Record<string, string>; // { "Dr. Name": "high" | "medium" | "low" }
  created_at: string;
  updated_at: string;
}

// ── Parser Types ──

export interface ParsedWhatsAppMessage {
  sender: string;
  timestamp: Date;
  content: string;
  group_name: string;
  is_system_message: boolean;
  hash: string;
  line_number: number;
}

// ── Classification Types (Pass A) ──

export interface ClassifiedMessage {
  hash: string;
  departments: string[];
  classification_reason: string;
}

// ── Extraction Types (Pass B) ──

export interface ExtractedDataPoint {
  field_label: string;
  value: string | number;
  data_date: string;
  confidence: 'high' | 'medium' | 'low';
  source_sender: string;
  source_time: string;
  context: string;
  source_hash: string;
}

export interface UnattributedMessage {
  hash: string;
  raw_text: string;
  reason: string;
}

export interface ExtractionResult {
  department_slug: string;
  data_points: ExtractedDataPoint[];
  unattributed_messages: UnattributedMessage[];
}

// ── Synthesis Types (Pass C) ──

export interface GlobalFlag {
  issue_id: string;
  issue_label: string;
  severity: 'red' | 'amber';
  details: string;
  data_date: string;
  source_group: string;
  source_sender: string;
  source_time: string;
}

export interface AnalysisSummary {
  total_messages_scanned: number;
  total_data_points: number;
  global_issues_count: number;
  unattributed_count: number;
  departments_with_data: string[];
  date_range: { start: string; end: string };
}

export interface RubricProposalDetail {
  keyword?: string;
  label?: string;
  type?: 'number' | 'text';
  extraction_hint?: string;
  target_slug?: string;
  sender_name?: string;
  department?: string;
  authority?: string;
  current_slug?: string | null;
  proposed_slug?: string;
  reason: string;
}

export interface RubricProposal {
  rubric_slug: string;
  proposal_type: 'new_keyword' | 'new_field' | 'new_dept_association' | 'sender_authority' | 'confidence_adjustment';
  proposal_detail: RubricProposalDetail;
  evidence: {
    message_excerpts: string[];
    occurrence_count: number;
    first_seen: string;
  };
}

export interface SynthesisResult {
  global_issues: GlobalFlag[];
  summary: AnalysisSummary;
  rubric_proposals: RubricProposal[];
}

// ── Analysis Card Types ──

export type AnalysisStatus = 'processing' | 'completed' | 'failed' | 'no_new_messages';

export interface AnalysisCardPayload {
  type: 'wa_analysis';
  analysis_id: string;
  status: AnalysisStatus;
  source_filename: string;
  source_group: string | null;
  total_parsed: number;
  new_processed: number;
  duplicates_skipped: number;
  departments_with_data: string[];
  date_range: { start: string; end: string } | null;
  severity_summary: { red: number; amber: number; data_points: number };
  rubric_proposals_count: number;
  processing_time_ms: number;
}

// ── Database Row Types ──

export interface WAAnalysisRow {
  id: string;
  uploaded_by: string;
  source_filename: string;
  source_type: string;
  source_group: string | null;
  channel_message_id: string | null;
  analysis_message_id: string | null;
  total_messages_parsed: number;
  new_messages_processed: number;
  duplicate_messages_skipped: number;
  departments_with_data: string[];
  date_range_start: string | null;
  date_range_end: string | null;
  processing_time_ms: number | null;
  llm_calls_made: number;
  llm_tokens_used: number;
  model_used: string;
  status: AnalysisStatus;
  error_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WAExtractedPointRow {
  id: string;
  analysis_id: string;
  department_slug: string;
  field_label: string;
  value_text: string | null;
  value_numeric: number | null;
  data_date: string;
  confidence: string;
  source_group: string;
  source_sender: string;
  source_time: string;
  source_message_hash: string;
  context: string;
  created_at: string;
}

export interface WAGlobalFlagRow {
  id: string;
  analysis_id: string;
  issue_id: string;
  issue_label: string;
  severity: string;
  details: string;
  data_date: string;
  source_group: string;
  source_sender: string;
  source_time: string;
  created_at: string;
}

export interface WARubricProposalRow {
  id: string;
  analysis_id: string;
  rubric_id: string;
  proposal_type: string;
  proposal_detail: RubricProposalDetail;
  evidence: { message_excerpts: string[]; occurrence_count: number; first_seen: string };
  status: 'pending' | 'approved' | 'dismissed';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
