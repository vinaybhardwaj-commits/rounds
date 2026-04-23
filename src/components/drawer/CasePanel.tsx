'use client';

// ============================================
// Rounds — CasePanel (Sprint 2 Day 6.B)
//
// Wrapper around <CaseDrawer mode="panel" /> that auto-resolves the active
// surgical_case for a given patient_thread_id. Embeds into PatientDetailView
// next to the existing OT Readiness SurgeryPanel (different domain — OT
// Readiness reads the `surgery_postings` table; this panel reads the new
// `surgical_cases` lifecycle model introduced in Sprint 1).
//
// Behavior:
//   - Fetches GET /api/cases?patient_thread_id={id}&limit=1 (returns [] when
//     FEATURE_CASE_MODEL_ENABLED is off → panel renders nothing, zero footprint)
//   - If a case is found, renders <CaseDrawer mode="panel" caseId={...}
//     fullViewHref="/case/:id" /> which shows the summary + Open-full-view btn
//   - If no cases and flag is on, renders nothing (no placeholder). We don't
//     want to nag users about cases that don't exist yet.
//
// Safe to drop into any patient-detail surface; no-op until the flag flips.
// ============================================

import { useEffect, useState } from 'react';
import CaseDrawer from './CaseDrawer';

interface MinimalCase {
  id: string;
  state: string;
  created_at: string;
}

interface CasePanelProps {
  patientThreadId: string;
}

export default function CasePanel({ patientThreadId }: CasePanelProps) {
  const [caseId, setCaseId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCaseId(null);
    setChecked(false);

    fetch(`/api/cases?patient_thread_id=${encodeURIComponent(patientThreadId)}&limit=1`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        // Flag off → feature_enabled:false, data:[] → leave caseId null → render nothing.
        if (body?.success && Array.isArray(body.data) && body.data.length > 0) {
          const c = body.data[0] as MinimalCase;
          setCaseId(c.id);
        }
      })
      .catch(() => {
        /* non-fatal; just don't render the panel */
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [patientThreadId]);

  // Render nothing until we've checked, or when there's no case. This keeps
  // the patient detail view quiet for patients who aren't surgical cases yet.
  if (!checked || !caseId) return null;

  return (
    <div className="mx-4 mb-3">
      <CaseDrawer
        caseId={caseId}
        mode="panel"
        fullViewHref={`/case/${caseId}`}
      />
    </div>
  );
}
