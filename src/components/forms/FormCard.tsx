'use client';

// ============================================
// FormCard — compact card for form submissions
// displayed inline in chat messages. Shows
// form type, status, completion, readiness
// summary. Clickable → /forms/[id].
// Also used in channel sidebar "Updates" tab.
// ============================================

import { useRouter } from 'next/navigation';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { FORM_TYPE_LABELS } from '@/lib/form-registry';
import type { FormType, ReadinessAggregate } from '@/types';

interface FormCardProps {
  formId: string;
  formType: FormType;
  status: string;
  submittedByName: string;
  createdAt: string;
  completionScore: number | null;
  readinessAggregate?: ReadinessAggregate | null;
  /** Compact mode for inline in messages */
  compact?: boolean;
}

export default function FormCard({
  formId,
  formType,
  status,
  submittedByName,
  createdAt,
  completionScore,
  readinessAggregate,
  compact = false,
}: FormCardProps) {
  const router = useRouter();
  const label = FORM_TYPE_LABELS[formType] || formType;
  const pct = completionScore != null ? Math.round(completionScore * 100) : null;
  const agg = readinessAggregate;

  const statusIcon =
    status === 'reviewed' ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> :
    status === 'flagged' ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> :
    status === 'draft' ? <Clock className="h-3.5 w-3.5 text-gray-400" /> :
    <FileText className="h-3.5 w-3.5 text-blue-500" />;

  const statusColor =
    status === 'submitted' ? 'border-blue-200 bg-blue-50/50' :
    status === 'draft' ? 'border-gray-200 bg-gray-50/50' :
    status === 'reviewed' ? 'border-green-200 bg-green-50/50' :
    'border-red-200 bg-red-50/50';

  return (
    <button
      onClick={() => router.push(`/forms/${formId}`)}
      className={`w-full text-left border rounded-lg hover:shadow-sm transition-all ${statusColor} ${
        compact ? 'p-2.5 max-w-xs' : 'p-3 max-w-sm'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className={`font-medium text-gray-900 flex-1 min-w-0 truncate ${compact ? 'text-xs' : 'text-sm'}`}>
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
      </div>

      {/* Meta */}
      <div className={`flex items-center gap-2 text-gray-500 mt-1 ${compact ? 'text-[10px]' : 'text-xs'}`}>
        <span>{submittedByName}</span>
        <span>&middot;</span>
        <span>
          {new Date(createdAt).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {pct != null && (
          <>
            <span>&middot;</span>
            <span className={pct === 100 ? 'text-green-600' : pct > 50 ? 'text-orange-500' : 'text-red-500'}>
              {pct}% complete
            </span>
          </>
        )}
      </div>

      {/* Readiness summary bar */}
      {agg && agg.total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Readiness</span>
            <span>{agg.confirmed}/{agg.total} confirmed</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden flex">
            {agg.confirmed > 0 && (
              <div className="h-1.5 bg-green-500" style={{ width: `${(agg.confirmed / agg.total) * 100}%` }} />
            )}
            {agg.flagged > 0 && (
              <div className="h-1.5 bg-red-500" style={{ width: `${(agg.flagged / agg.total) * 100}%` }} />
            )}
          </div>
        </div>
      )}
    </button>
  );
}
