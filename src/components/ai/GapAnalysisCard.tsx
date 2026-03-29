'use client';

// ============================================
// GapAnalysisCard — shows AI gap report for a form.
// Appears on form view pages with "Analyze" button.
// Step 8.1: AI Gap Analysis
// ============================================

import { useState } from 'react';
import { Brain, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface GapReport {
  score: number;
  summary: string;
  critical_gaps: Array<{
    field: string;
    reason: string;
    risk_level: 'high' | 'medium' | 'low';
  }>;
  recommendations: string[];
  flags: string[];
}

interface GapAnalysisCardProps {
  formSubmissionId: string;
  existingReport?: GapReport | null;
}

const RISK_COLORS = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-orange-50 text-orange-700 border-orange-200',
  low: 'bg-yellow-50 text-yellow-700 border-yellow-200',
};

export function GapAnalysisCard({ formSubmissionId, existingReport }: GapAnalysisCardProps) {
  const [report, setReport] = useState<GapReport | null>(existingReport || null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/gap-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_submission_id: formSubmissionId }),
      });
      const data = await res.json();
      if (data.success) {
        setReport(data.data);
        setExpanded(true);
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  // Score ring color
  const scoreColor =
    report && report.score >= 80
      ? 'text-green-500'
      : report && report.score >= 50
      ? 'text-orange-500'
      : 'text-red-500';

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
        <Brain size={18} className="text-purple-500" />
        <span className="text-sm font-semibold text-even-navy flex-1">AI Gap Analysis</span>
        {report && (
          <span className={`text-lg font-bold ${scoreColor}`}>{report.score}/100</span>
        )}
        {!report && (
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain size={12} />
                Analyze
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs">
          {error}
        </div>
      )}

      {/* Report content */}
      {report && (
        <div className="px-4 py-3">
          <p className="text-sm text-gray-700 mb-3">{report.summary}</p>

          {/* Critical gaps */}
          {report.critical_gaps.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2"
              >
                <AlertTriangle size={12} className="text-red-500" />
                {report.critical_gaps.length} Gap{report.critical_gaps.length !== 1 ? 's' : ''} Found
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {expanded && (
                <div className="space-y-1.5">
                  {report.critical_gaps.map((gap, i) => (
                    <div
                      key={i}
                      className={`px-3 py-2 rounded-lg border text-xs ${RISK_COLORS[gap.risk_level]}`}
                    >
                      <span className="font-semibold">{gap.field}</span>
                      <span className="mx-1.5">—</span>
                      <span>{gap.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {expanded && report.recommendations.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Recommendations
              </p>
              <div className="space-y-1">
                {report.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <CheckCircle size={12} className="text-green-400 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flags */}
          {expanded && report.flags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Flags
              </p>
              <div className="space-y-1">
                {report.flags.map((flag, i) => (
                  <div key={i} className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                    ⚠ {flag}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Re-analyze button */}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="mt-3 text-xs text-purple-500 hover:text-purple-700 disabled:opacity-50"
          >
            {loading ? 'Re-analyzing...' : 'Re-analyze'}
          </button>
        </div>
      )}
    </div>
  );
}
