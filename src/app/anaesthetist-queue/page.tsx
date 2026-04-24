'use client';

// ============================================
// Rounds — /anaesthetist-queue page (Sprint 2 Day 7.B)
//
// Lists cases awaiting PAC action for the logged-in anaesthetist's accessible
// hospitals. Row click opens PacPublishModal inline; on successful publish the
// row disappears from the queue (state moves out of publishable-from set).
//
// Filter: state IN (intake, pac_scheduled, pac_done) — uses the existing
// /api/cases listing endpoint with state param (one request per state since
// Sprint 1 Day 4's listing accepts a single state filter).
//
// Access control: role gate client-side (anaesthesiologist + super_admin);
// server enforces same via /api/cases tenancy + /api/cases/:id/pac/publish
// role check (D7). Client gate is UX, not security.
//
// Route: /anaesthetist-queue (no dynamic segment; accessed from sidebar link
// once wired by a future sprint).
// ============================================

import { useEffect, useState, useCallback } from 'react';
import PacPublishModal from '@/components/drawer/PacPublishModal';

interface QueueCase {
  id: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
  urgency: string | null;
  state: string;
  created_at: string;
}

const QUEUE_STATES: Array<QueueCase['state']> = ['intake', 'pac_scheduled', 'pac_done'];
const PUBLISH_ROLES = new Set(['anesthesiologist', 'super_admin']);

export default function AnaesthetistQueuePage() {
  const [cases, setCases] = useState<QueueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  const [activeCase, setActiveCase] = useState<QueueCase | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // Pull all 3 states in parallel so we get the full queue in one render.
    Promise.all(
      QUEUE_STATES.map((st) =>
        fetch(`/api/cases?state=${st}&limit=100`).then((r) => r.json())
      )
    )
      .then((results) => {
        const combined: QueueCase[] = [];
        let flagOk = true;
        let err: string | null = null;
        for (const body of results) {
          if (!body?.success) {
            err = body?.error || 'Failed to load queue';
            continue;
          }
          if (body.feature_enabled === false) flagOk = false;
          if (Array.isArray(body.data)) combined.push(...body.data);
        }
        if (err && combined.length === 0) {
          setError(err);
        } else {
          // Stable order: urgency desc (emergency > urgent > elective), then planned_surgery_date asc, then created_at asc.
          const urgencyRank: Record<string, number> = { emergency: 0, urgent: 1, elective: 2 };
          combined.sort((a, b) => {
            const ua = urgencyRank[a.urgency || ''] ?? 3;
            const ub = urgencyRank[b.urgency || ''] ?? 3;
            if (ua !== ub) return ua - ub;
            const da = a.planned_surgery_date ? new Date(a.planned_surgery_date).getTime() : Infinity;
            const db = b.planned_surgery_date ? new Date(b.planned_surgery_date).getTime() : Infinity;
            if (da !== db) return da - db;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });
          setCases(combined);
        }
        setFeatureEnabled(flagOk);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.success && body.data?.role) setRole(body.data.role);
      })
      .catch(() => { /* non-fatal */ });
    load();
  }, [load]);

  const canPublish = role ? PUBLISH_ROLES.has(role) : false;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Anaesthetist Queue</h1>
          <p className="mt-1 text-sm text-gray-600">
            Cases awaiting PAC action in your accessible hospitals. Click a row to publish an outcome.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {!featureEnabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Feature-flagged:</strong> Case model is disabled (<code>FEATURE_CASE_MODEL_ENABLED</code> is not true).
          Queue will populate after the flag flips; planned for Sprint 2 Day 10.
        </div>
      )}

      {role && !canPublish && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          You&rsquo;re signed in as <code>{role}</code> — you can view the queue but publishing PAC outcomes requires <code>anaesthesiologist</code> or <code>super_admin</code>.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          Error: {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading queue…</p>}

      {!loading && !error && cases.length === 0 && featureEnabled && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-sm font-medium text-gray-900">Queue is empty.</p>
          <p className="mt-1 text-xs text-gray-600">
            No cases in <code>intake</code>, <code>pac_scheduled</code>, or <code>pac_done</code> for your hospitals.
          </p>
        </div>
      )}

      {cases.length > 0 && (
        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                    <span>{c.patient_name || '(no name)'}</span>
                    <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-700">
                      {c.hospital_slug?.toUpperCase()}
                    </span>
                    <span className="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-normal text-indigo-800">
                      {c.state}
                    </span>
                    {c.urgency && (
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-normal ${
                          c.urgency === 'emergency' ? 'bg-red-100 text-red-800' :
                          c.urgency === 'urgent' ? 'bg-orange-100 text-orange-800' :
                          'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {c.urgency}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {c.planned_procedure || '(no procedure yet)'}
                    {c.planned_surgery_date && ` · planned ${new Date(c.planned_surgery_date).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <a
                    href={`/case/${c.id}`}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => setActiveCase(c)}
                    disabled={!canPublish}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    title={canPublish ? 'Publish PAC outcome' : 'Only anaesthesiologists or super_admin can publish'}
                  >
                    Publish PAC
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PacPublishModal
        caseId={activeCase?.id ?? ''}
        patientName={activeCase?.patient_name ?? null}
        currentState={activeCase?.state ?? ''}
        isOpen={!!activeCase}
        onClose={() => setActiveCase(null)}
        onPublished={() => { setActiveCase(null); load(); }}
      />
    </main>
  );
}
