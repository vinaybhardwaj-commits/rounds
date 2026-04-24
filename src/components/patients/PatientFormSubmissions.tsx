'use client';

// ============================================
// Rounds — Patient Form Submissions Panel (24 Apr 2026)
// Mounted on PatientDetailView Overview tab.
// Lists every versioned form type for this patient, with submission count,
// latest submitter + timestamp, and actions:
//   - View latest  → /forms/[id]
//   - All versions → existing VersionHistoryDrawer
//   - Start form   → /forms/new?type=X&patient_id=Y (when no submissions yet)
//
// Fetches via existing GET /api/forms?patient_thread_id=X&limit=100. No new
// backend. Four versioned types are listed per VERSIONED_FORM_TYPES in
// FormRenderer.tsx + api/forms/route.ts (kept in sync manually for now).
// ============================================

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import VersionHistoryDrawer from '@/components/forms/VersionHistoryDrawer';
import type { FormSubmission, FormType } from '@/types';

const VERSIONED_TYPES: { key: FormType; label: string }[] = [
  { key: 'consolidated_marketing_handoff' as FormType, label: 'Marketing Handoff' },
  { key: 'financial_counseling' as FormType, label: 'Financial Counseling' },
  { key: 'surgery_booking' as FormType, label: 'Surgery Booking' },
  { key: 'admission_advice' as FormType, label: 'Admission Advice' },
];

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

interface Props {
  patientThreadId: string;
}

interface Grouped {
  [formType: string]: FormSubmission[];
}

export default function PatientFormSubmissions({ patientThreadId }: Props) {
  const [groups, setGroups] = useState<Grouped>({});
  const [loading, setLoading] = useState(true);
  const [drawerType, setDrawerType] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/forms?patient_thread_id=${patientThreadId}&limit=100`
        );
        const json = await res.json();
        if (cancelled || !json.success) return;
        const subs: FormSubmission[] = json.data || [];
        const g: Grouped = {};
        for (const s of subs) {
          if (!g[s.form_type]) g[s.form_type] = [];
          g[s.form_type].push(s);
        }
        // Newest first so group[type][0] is the latest submission.
        for (const k of Object.keys(g)) {
          g[k].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        }
        setGroups(g);
      } catch (err) {
        console.error('[PatientFormSubmissions] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientThreadId]);

  return (
    <div className="mx-4 mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Form Submissions
      </h3>
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="p-3 text-xs text-gray-400">Loading…</div>
        ) : (
          VERSIONED_TYPES.map(({ key, label }) => {
            const subs = groups[key] || [];
            const count = subs.length;
            const latest = subs[0];
            return (
              <div key={key} className="flex items-center gap-3 p-3">
                <FileText size={16} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{label}</span>
                    <span className="text-xs text-gray-500">
                      {count === 0
                        ? '0 submitted'
                        : `${count} version${count === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  {latest && (
                    <div className="text-xs text-gray-500 truncate mt-0.5">
                      Latest by {latest.submitted_by_name || 'Unknown'} ·{' '}
                      {formatDate(latest.created_at)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {latest ? (
                    <>
                      <a
                        href={`/forms/${latest.id}`}
                        className="text-xs font-medium text-even-blue hover:underline"
                      >
                        View latest
                      </a>
                      {count > 1 && (
                        <button
                          type="button"
                          onClick={() => setDrawerType(key)}
                          className="text-xs font-medium text-gray-700 hover:text-gray-900"
                        >
                          All versions
                        </button>
                      )}
                    </>
                  ) : (
                    <a
                      href={`/forms/new?type=${key}&patient_id=${patientThreadId}`}
                      className="text-xs font-medium text-even-blue hover:underline"
                    >
                      Start form
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {drawerType && groups[drawerType]?.[0] && (
        <VersionHistoryDrawer
          patientThreadId={patientThreadId}
          formType={drawerType}
          currentFormId={groups[drawerType][0].id}
          open={true}
          onClose={() => setDrawerType(null)}
        />
      )}
    </div>
  );
}
