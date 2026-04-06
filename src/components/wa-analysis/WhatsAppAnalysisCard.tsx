// ============================================
// WhatsAppAnalysisCard — Rich inline card for
// analysis results, rendered in the chat channel.
// Phase: WA.3
// ============================================

'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  BarChart3,
  Calendar,
  Clock,
  Lightbulb,
  Activity,
} from 'lucide-react';

interface AnalysisPayload {
  type: 'wa_analysis';
  analysis_id: string;
  status: string;
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

interface DataPoint {
  field_label: string;
  value_text: string | null;
  value_numeric: number | null;
  confidence: string;
  source_sender: string;
  source_time: string;
  context: string;
  data_date: string;
}

interface GlobalFlag {
  issue_label: string;
  severity: string;
  details: string;
  source_sender: string;
  source_time: string;
  data_date: string;
}

interface DeptData {
  department_slug: string;
  points: DataPoint[];
}

interface WhatsAppAnalysisCardProps {
  payload: AnalysisPayload;
}

const DEPT_LABELS: Record<string, string> = {
  'emergency': 'Emergency',
  'customer-care': 'Customer Care',
  'patient-safety': 'Patient Safety & Quality',
  'finance': 'Finance',
  'billing': 'Billing',
  'supply-chain': 'Supply Chain',
  'facility': 'Facility & Engineering',
  'pharmacy': 'Pharmacy',
  'training': 'Training',
  'clinical-lab': 'Clinical Lab',
  'radiology': 'Radiology',
  'ot': 'OT (Operating Theatre)',
  'hr-manpower': 'HR & Manpower',
  'diet': 'Diet & Nutrition',
  'biomedical': 'Biomedical',
  'nursing': 'Nursing',
  'it': 'IT',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-green-600 bg-green-50',
  medium: 'text-yellow-600 bg-yellow-50',
  low: 'text-gray-500 bg-gray-100',
};

export default function WhatsAppAnalysisCard({ payload }: WhatsAppAnalysisCardProps) {
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [showIssues, setShowIssues] = useState(false);
  const [deptData, setDeptData] = useState<DeptData[]>([]);
  const [globalFlags, setGlobalFlags] = useState<GlobalFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { severity_summary: sev } = payload;

  // Fetch detailed data when any section is first expanded
  const loadDetails = async () => {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/wa-analysis/${payload.analysis_id}`);
      const json = await res.json();
      if (json.success && json.data) {
        setDeptData(json.data.departments || []);
        setGlobalFlags(json.data.global_flags || []);
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const toggleDept = (slug: string) => {
    if (!loaded) loadDetails();
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleIssues = () => {
    if (!loaded) loadDetails();
    setShowIssues(prev => !prev);
  };

  if (payload.status === 'no_new_messages') {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-w-md">
        <p className="text-sm text-gray-500">All {payload.total_parsed} messages already analyzed. No new data.</p>
      </div>
    );
  }

  if (payload.status === 'failed') {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-3 max-w-md">
        <p className="text-sm text-red-600">Analysis failed. Check admin panel for details.</p>
      </div>
    );
  }

  if (payload.status === 'processing') {
    return (
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 max-w-md">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-blue-600">Analyzing {payload.new_processed} messages...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm max-w-lg overflow-hidden mt-1">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 size={16} className="text-green-600" />
          <span className="text-sm font-semibold text-gray-800">WhatsApp Analysis</span>
          {payload.date_range && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Calendar size={11} />
              {payload.date_range.start} to {payload.date_range.end}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {payload.source_group} — {payload.new_processed} messages analyzed
          {payload.duplicates_skipped > 0 && ` (${payload.duplicates_skipped} skipped)`}
        </p>
      </div>

      {/* Summary badges */}
      <div className="px-3 py-2 flex flex-wrap gap-2 border-b border-gray-100">
        {sev.red > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <AlertCircle size={12} /> {sev.red} Critical
          </span>
        )}
        {sev.amber > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <AlertTriangle size={12} /> {sev.amber} Warnings
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
          <Activity size={12} /> {sev.data_points} Data Points
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <Clock size={12} /> {(payload.processing_time_ms / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Global Issues (expandable) */}
      {(sev.red > 0 || sev.amber > 0) && (
        <div className="border-b border-gray-100">
          <button
            onClick={toggleIssues}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
          >
            {showIssues ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-xs font-medium text-gray-700">
              Global Issues ({sev.red + sev.amber})
            </span>
          </button>
          {showIssues && (
            <div className="px-3 pb-2 space-y-1">
              {loading && <p className="text-xs text-gray-400">Loading...</p>}
              {globalFlags.map((flag, i) => (
                <div key={i} className={`rounded px-2 py-1 text-xs ${
                  flag.severity === 'red' ? 'bg-red-50 border-l-2 border-red-400' : 'bg-yellow-50 border-l-2 border-yellow-400'
                }`}>
                  <div className="font-medium text-gray-800">
                    {flag.severity === 'red' ? '🔴' : '🟡'} {flag.issue_label}
                  </div>
                  <div className="text-gray-600">{flag.details}</div>
                  {flag.source_sender && (
                    <div className="text-gray-400 mt-0.5">{flag.source_sender} · {flag.source_time} · {flag.data_date}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Department sections (expandable) */}
      <div className="divide-y divide-gray-100">
        {payload.departments_with_data.map(slug => {
          const expanded = expandedDepts.has(slug);
          const dept = deptData.find(d => d.department_slug === slug);
          const pointCount = dept?.points?.length || '...';

          return (
            <div key={slug}>
              <button
                onClick={() => toggleDept(slug)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="text-xs font-medium text-gray-700">
                  {DEPT_LABELS[slug] || slug}
                </span>
                <span className="text-xs text-gray-400">({pointCount} points)</span>
              </button>
              {expanded && dept && (
                <div className="px-3 pb-2 space-y-1">
                  {loading && <p className="text-xs text-gray-400">Loading...</p>}
                  {dept.points.map((dp, i) => (
                    <div key={i} className="bg-gray-50 rounded px-2 py-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{dp.field_label}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          CONFIDENCE_COLORS[dp.confidence] || CONFIDENCE_COLORS.low
                        }`}>
                          {dp.confidence}
                        </span>
                      </div>
                      <div className="text-gray-700 font-semibold">
                        {dp.value_numeric !== null ? dp.value_numeric : dp.value_text}
                      </div>
                      {dp.context && (
                        <div className="text-gray-400 italic mt-0.5 truncate">"{dp.context}"</div>
                      )}
                      <div className="text-gray-400 mt-0.5">
                        {dp.source_sender} · {dp.source_time} · {dp.data_date}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Rubric proposals indicator */}
      {payload.rubric_proposals_count > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-100 bg-purple-50">
          <div className="flex items-center gap-1.5 text-xs text-purple-700">
            <Lightbulb size={12} />
            <span>{payload.rubric_proposals_count} rubric improvement{payload.rubric_proposals_count > 1 ? 's' : ''} suggested</span>
          </div>
        </div>
      )}
    </div>
  );
}
