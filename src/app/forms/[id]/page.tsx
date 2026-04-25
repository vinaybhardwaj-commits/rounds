'use client';

// ============================================
// /forms/[id] — Read-only form view
// Shows submitted form data with section layout,
// readiness item status, and completion score.
// ============================================

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  AlertTriangle,
  Minus,
  FileText,
  User,
  Calendar,
  Printer,
} from 'lucide-react';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  type FormSchema,
} from '@/lib/form-registry';
import { GapAnalysisCard } from '@/components/ai/GapAnalysisCard';
import type {
  FormType,
  ReadinessStatus,
  ReadinessItem,
  ReadinessAggregate,
} from '@/types';
import {
  READINESS_COLORS,
} from '@/types';

interface FormViewData {
  id: string;
  form_type: FormType;
  form_version: number;
  status: string;
  submitted_by: string;
  submitted_by_name: string;
  patient_thread_id: string | null;
  form_data: Record<string, unknown>;
  completion_score: number | null;
  created_at: string;
  readiness_items: ReadinessItem[];
  readiness_aggregate: ReadinessAggregate | null;
}

const STATUS_ICONS: Record<ReadinessStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-orange-500" />,
  confirmed: <CheckCircle className="h-4 w-4 text-green-500" />,
  flagged: <AlertTriangle className="h-4 w-4 text-red-500" />,
  not_applicable: <Minus className="h-4 w-4 text-gray-400" />,
};

export default function FormViewPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [data, setData] = useState<FormViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 24 Apr 2026 (Commit D) — previous version of this form for this patient,
  // used to highlight changed fields. Null = no prior version or still loading.
  const [prevFormData, setPrevFormData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/forms/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data);
        else setError(res.error || 'Form not found');
      })
      .catch(() => setError('Failed to load form'))
      .finally(() => setLoading(false));
  }, [id]);

  // 24 Apr 2026 (Commit D) — fetch the immediately-prior submission for
  // the same patient + form_type, to compute the diff set. First submission
  // (no prior) renders with no highlighting.
  useEffect(() => {
    if (!data || !data.patient_thread_id) return;
    fetch(
      `/api/forms?form_type=${encodeURIComponent(data.form_type)}&patient_thread_id=${encodeURIComponent(data.patient_thread_id)}&status=submitted&limit=20`
    )
      .then((r) => r.json())
      .then((body) => {
        if (!body?.success || !Array.isArray(body.data)) return;
        type Row = { id: string; form_data: Record<string, unknown>; created_at: string };
        const list = body.data as Row[];
        const sorted = [...list].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const idx = sorted.findIndex((s) => s.id === data.id);
        if (idx > 0) setPrevFormData(sorted[idx - 1].form_data);
      })
      .catch(() => {});
  }, [data]);

  // 25 Apr 2026 fix: useMemo MUST be called on every render (Rules of Hooks).
  // Previously this was below the early-returns for loading/error, so on the
  // first render (loading=true) it wasn't called, but on subsequent renders
  // (data loaded) it was — different hook counts → React #310. The internal
  // null-check on prevFormData covers the no-data case while data still loads.
  // 24 Apr 2026 (Commit D): compute the set of fields that differ from the
  // prior version. Empty set if no prior. Changed fields get .field-changed
  // (subtle yellow highlight on screen, stripped on print).
  const changedFields = useMemo<Set<string>>(() => {
    if (!data || !prevFormData) return new Set<string>();
    const s = new Set<string>();
    const keys = new Set([
      ...Object.keys(data.form_data || {}),
      ...Object.keys(prevFormData || {}),
    ]);
    for (const k of keys) {
      if (k.startsWith('_')) continue; // skip computed metadata
      if (JSON.stringify(data.form_data?.[k]) !== JSON.stringify(prevFormData?.[k])) {
        s.add(k);
      }
    }
    return s;
  }, [data, prevFormData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg border border-gray-200 p-8 max-w-md text-center">
          <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900">{error || 'Form not found'}</h2>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const schema: FormSchema | undefined = FORM_REGISTRY[data.form_type];
  const formLabel = FORM_TYPE_LABELS[data.form_type] || data.form_type;
  const completionPct = data.completion_score != null ? Math.round(data.completion_score * 100) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 no-print">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">{formLabel}</h1>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${
                data.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                data.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                data.status === 'reviewed' ? 'bg-green-100 text-green-700' :
                'bg-red-100 text-red-700'
              }`}>
                {data.status}
              </span>
            </div>
          </div>
          {/* Print button (Commit D) — strips highlights + hides UI chrome via @media print */}
          {data.status === 'submitted' && (
            <button
              onClick={() => window.print()}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              title="Print this form"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Meta info card */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Submitted by:</span>
              <span className="font-medium text-gray-900">{data.submitted_by_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Date:</span>
              <span className="font-medium text-gray-900">
                {new Date(data.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Version:</span>
              <span className="font-medium text-gray-900">v{data.form_version}</span>
            </div>
          </div>

          {/* Completion bar */}
          {completionPct != null && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Completion</span>
                <span>{completionPct}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${completionPct}%`,
                    backgroundColor: completionPct === 100 ? '#22C55E' : completionPct > 50 ? '#F97316' : '#EF4444',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* AI Gap Analysis */}
        <GapAnalysisCard
          formSubmissionId={data.id}
          existingReport={data.ai_gap_report}
        />

        {/* Readiness tracker */}
        {data.readiness_items.length > 0 && data.readiness_aggregate && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-800">Readiness Tracker</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: READINESS_COLORS.confirmed }}>
                  {data.readiness_aggregate.confirmed}/{data.readiness_aggregate.total}
                </span>
                <span className="text-xs text-gray-500">confirmed</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-3 mb-4 overflow-hidden flex">
              {data.readiness_aggregate.confirmed > 0 && (
                <div className="h-3 bg-green-500" style={{ width: `${(data.readiness_aggregate.confirmed / data.readiness_aggregate.total) * 100}%` }} />
              )}
              {data.readiness_aggregate.flagged > 0 && (
                <div className="h-3 bg-red-500" style={{ width: `${(data.readiness_aggregate.flagged / data.readiness_aggregate.total) * 100}%` }} />
              )}
              {data.readiness_aggregate.not_applicable > 0 && (
                <div className="h-3 bg-gray-300" style={{ width: `${(data.readiness_aggregate.not_applicable / data.readiness_aggregate.total) * 100}%` }} />
              )}
            </div>

            {/* Readiness items grouped by category */}
            <div className="space-y-3">
              {Object.entries(groupByCategory(data.readiness_items)).map(([category, items]) => (
                <div key={category}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {category}
                  </p>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        {STATUS_ICONS[item.status as ReadinessStatus]}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800">{item.item_name}</p>
                          {item.confirmed_by_name && (
                            <p className="text-xs text-gray-500">
                              Confirmed by {item.confirmed_by_name}
                              {item.confirmed_at && ` · ${new Date(item.confirmed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          )}
                          {item.status === 'flagged' && item.notes && (
                            <p className="text-xs text-red-600 mt-0.5">{item.notes}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {item.responsible_role?.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form data sections */}
        {schema ? (
          // Render using schema structure
          schema.sections.map((section) => {
            // 25 Apr 2026 (M7 fix): respect section-level visibleWhen so a
            // Section C (surgery_booking) hidden by _is_surgical_case=false
            // doesn't render with stale values carried over from a prior
            // submission.
            if (section.visibleWhen) {
              const val = data.form_data[section.visibleWhen.field];
              const op = section.visibleWhen.operator;
              const want = section.visibleWhen.value;
              const met = op === 'truthy' ? !!val
                : op === 'eq' ? val === want
                : op === 'neq' ? val !== want
                : op === 'in' ? Array.isArray(want) && (want as unknown[]).includes(val)
                : false;
              if (!met) return null;
            }
            const visibleFields = section.fields.filter((f) => {
              if (!f.visibleWhen) return true;
              const val = data.form_data[f.visibleWhen.field];
              switch (f.visibleWhen.operator) {
                case 'eq': return val === f.visibleWhen.value;
                case 'neq': return val !== f.visibleWhen.value;
                case 'truthy': return !!val;
                default: return true;
              }
            });
            const hasValues = visibleFields.some((f) => {
              const v = data.form_data[f.key];
              return v !== null && v !== undefined && v !== '' && v !== false;
            });
            if (!hasValues) return null;

            return (
              <div key={section.id} className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-base font-semibold text-gray-800 mb-3">{section.title}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {visibleFields.map((field) => {
                    const value = data.form_data[field.key];
                    if (value === null || value === undefined || value === '' || value === false) return null;

                    // Checkbox fields — show as checkmark
                    if (field.type === 'checkbox' && value === true) {
                      const cbChanged = changedFields.has(field.key);
                      return (
                        <div
                          key={field.key}
                          className={`sm:col-span-2 flex items-center gap-2 text-sm ${cbChanged ? 'field-changed' : ''}`}
                        >
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          <span className="text-gray-700">{field.label}</span>
                          {cbChanged && (
                            <span className="no-print ml-1.5 inline-block rounded bg-yellow-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800">
                              edited
                            </span>
                          )}
                        </div>
                      );
                    }

                    // Select fields — show label not value
                    let displayValue: string = String(value);
                    if ((field.type === 'select' || field.type === 'radio') && field.options) {
                      const opt = field.options.find((o) => o.value === value);
                      if (opt) displayValue = opt.label;
                    }

                    // Date fields — format nicely
                    if (field.type === 'date' && typeof value === 'string') {
                      const d = new Date(value);
                      if (!isNaN(d.getTime())) {
                        displayValue = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                      }
                    }

                    const colSpan = field.type === 'textarea' ? 'sm:col-span-2' : '';
                    const isChanged = changedFields.has(field.key);

                    return (
                      <div
                        key={field.key}
                        className={`${colSpan} ${isChanged ? 'field-changed' : ''}`}
                      >
                        <p className="text-xs text-gray-500 mb-0.5">
                          {field.label}
                          {isChanged && (
                            <span className="no-print ml-1.5 inline-block rounded bg-yellow-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800">
                              edited
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-900 whitespace-pre-wrap">{displayValue}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          // Fallback: raw JSON display if no schema
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-base font-semibold text-gray-800 mb-3">Form Data</h3>
            <pre className="text-xs text-gray-700 bg-gray-50 p-3 rounded overflow-x-auto">
              {JSON.stringify(data.form_data, null, 2)}
            </pre>
          </div>
        )}

        {/* Link to patient thread */}
        {data.patient_thread_id && (
          <div className="text-center no-print">
            <button
              onClick={() => router.push(`/`)}
              className="text-sm text-blue-600 hover:underline"
            >
              Back to Chat
            </button>
          </div>
        )}
      </main>

      {/* 24 Apr 2026 (Commit D) — on-screen diff highlight + print-safe styles */}
      <style>{`
        @media screen {
          .field-changed {
            background-color: rgb(254 252 232);
            border-left: 3px solid rgb(234 179 8);
            padding-left: 8px;
            margin-left: -11px;
            border-radius: 3px;
          }
        }
        @media print {
          .no-print { display: none !important; }
          header { position: static !important; box-shadow: none !important; }
          body, main { background: white !important; }
          .bg-gray-50 { background: white !important; }
          .bg-white { box-shadow: none !important; }
          .rounded-lg { border-radius: 0 !important; }
          .sticky { position: static !important; }
          .field-changed {
            background: none !important;
            border: none !important;
            padding-left: 0 !important;
            margin-left: 0 !important;
          }
          /* Force a reasonable print page width */
          .max-w-3xl { max-width: none !important; }
        }
      `}</style>
    </div>
  );
}

// Helper: group readiness items by category
function groupByCategory(items: ReadinessItem[]): Record<string, ReadinessItem[]> {
  const groups: Record<string, ReadinessItem[]> = {};
  for (const item of items) {
    const cat = item.item_category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  return groups;
}
