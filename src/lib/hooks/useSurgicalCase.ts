'use client';

// =============================================================================
// useSurgicalCase — single-fetch surgical case hook (26 Apr 2026 follow-up FU3 / P2-2)
//
// OTPlanningPanel + PatientOTTab were each calling
// /api/cases?patient_thread_id=<id>&limit=1 independently. When both rendered
// at once (Overview tab open with the OT tab visible), prod fired two
// identical requests. This hook centralizes the fetch so the parent
// (PatientDetailView) loads once and passes the result to both children.
//
// Returns: { caseRow, loading, error, refetch, createCase }
//   - createCase: POSTs /api/cases for the patient (idempotent server-side)
//     and refetches on success.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';

export interface SurgicalCaseLite {
  id: string;
  state: string;
  hospital_slug: string;
  hospital_id?: string;
  planned_procedure?: string | null;
  planned_surgery_date?: string | null;
  urgency?: string | null;
  created_at: string;
}

export interface UseSurgicalCaseResult {
  caseRow: SurgicalCaseLite | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch after a known mutation (e.g., booking saved). */
  refetch: () => void;
  /** POST /api/cases to create-or-return-existing for this patient. */
  createCase: () => Promise<SurgicalCaseLite | null>;
}

export function useSurgicalCase(patientThreadId: string | null | undefined): UseSurgicalCaseResult {
  const [caseRow, setCaseRow] = useState<SurgicalCaseLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!patientThreadId) {
      setCaseRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/cases?patient_thread_id=${encodeURIComponent(patientThreadId)}&limit=1`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data) && body.data.length > 0) {
          setCaseRow(body.data[0] as SurgicalCaseLite);
        } else {
          setCaseRow(null);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [patientThreadId]);

  useEffect(() => { refetch(); }, [refetch]);

  const createCase = useCallback(async (): Promise<SurgicalCaseLite | null> => {
    if (!patientThreadId) return null;
    setError(null);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_thread_id: patientThreadId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      refetch();
      return (body.data as SurgicalCaseLite) ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [patientThreadId, refetch]);

  return { caseRow, loading, error, refetch, createCase };
}
