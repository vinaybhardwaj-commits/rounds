'use client';

// ============================================
// AnalysisHistory — List of past WhatsApp analyses
// Shows status, message counts, date ranges.
// Phase: WA.2
// ============================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  FileText,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  SkipForward,
  RefreshCw,
} from 'lucide-react';

interface AnalysisRow {
  id: string;
  source_filename: string;
  source_group: string | null;
  status: string;
  total_messages_parsed: number;
  new_messages_processed: number;
  duplicate_messages_skipped: number;
  departments_with_data: string[];
  date_range_start: string | null;
  date_range_end: string | null;
  processing_time_ms: number | null;
  created_at: string;
  uploaded_by_name: string | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: 'text-green-600', label: 'Completed' },
  processing: { icon: Loader2, color: 'text-blue-600', label: 'Processing' },
  failed: { icon: AlertCircle, color: 'text-red-600', label: 'Failed' },
  no_new_messages: { icon: SkipForward, color: 'text-gray-500', label: 'No New Data' },
};

interface AnalysisHistoryProps {
  refreshTrigger?: number; // increment to trigger a refresh
}

export default function AnalysisHistory({ refreshTrigger }: AnalysisHistoryProps) {
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalyses = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/wa-analysis/list?limit=20');
      const data = await res.json();
      if (data.success) {
        setAnalyses(data.data || []);
        setError(null);
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses, refreshTrigger]);

  if (loading && analyses.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        Loading analyses...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-lg p-4 text-sm text-red-700 flex items-start gap-2">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        {error}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText size={32} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm text-gray-500">No analyses yet. Upload a WhatsApp export to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Analysis History</h3>
        <button
          onClick={fetchAnalyses}
          className="text-gray-400 hover:text-gray-600 p-1"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-2">
        {analyses.map((a) => {
          const statusCfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.completed;
          const StatusIcon = statusCfg.icon;

          return (
            <div
              key={a.id}
              className="bg-white border border-gray-100 rounded-lg p-3 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${statusCfg.color}`}>
                  <StatusIcon size={16} className={a.status === 'processing' ? 'animate-spin' : ''} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {a.source_group || a.source_filename}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      a.status === 'completed' ? 'bg-green-50 text-green-700' :
                      a.status === 'no_new_messages' ? 'bg-gray-100 text-gray-500' :
                      a.status === 'failed' ? 'bg-red-50 text-red-700' :
                      'bg-blue-50 text-blue-700'
                    }`}>
                      {statusCfg.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{a.total_messages_parsed} msgs</span>
                    {a.new_messages_processed > 0 && (
                      <span className="text-green-600">{a.new_messages_processed} new</span>
                    )}
                    {a.duplicate_messages_skipped > 0 && (
                      <span>{a.duplicate_messages_skipped} dups</span>
                    )}
                    {a.processing_time_ms != null && (
                      <span className="flex items-center gap-0.5">
                        <Clock size={10} />
                        {a.processing_time_ms}ms
                      </span>
                    )}
                  </div>

                  {a.date_range_start && a.date_range_end && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.date_range_start} → {a.date_range_end}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <span>{new Date(a.created_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}</span>
                    {a.uploaded_by_name && <span>by {a.uploaded_by_name}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
