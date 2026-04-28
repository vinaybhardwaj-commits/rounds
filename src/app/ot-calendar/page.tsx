// =============================================================================
// /ot-calendar — 308 Permanent Redirect (OT.4, 28 Apr 2026)
//
// Per OT Management Module PRD v1.1 LOCKED Q8: /ot-calendar folds into
// /ot-management?tab=week. The 807-LOC week-view body now lives at
// src/components/ot-management/WeekView.tsx and renders inline as the Week
// section of the OT module.
//
// Why a server-side redirect rather than rendering: single source of truth
// for the calendar UI; bookmarks update transparently; entry-points (OT.4f)
// migrate to /ot-management?tab=week&patient_id={id}.
//
// Tolerates legacy ?patient= and ?focus_id= query params, translates both to
// the new ?patient_id= canonical convention before redirecting.
// =============================================================================

import { redirect, permanentRedirect } from 'next/navigation';

export default function OTCalendarRedirectPage({
  searchParams,
}: {
  searchParams: { patient_id?: string; patient?: string; focus_id?: string; tab?: string };
}) {
  const patientId =
    searchParams.patient_id || searchParams.patient || searchParams.focus_id || '';
  const params = new URLSearchParams();
  params.set('tab', 'week');
  if (patientId) params.set('patient_id', patientId);

  // permanentRedirect issues a 308; if not available in this Next version, the
  // import above falls back to redirect() which issues a 307 — still functional
  // but less ideal for caching. permanentRedirect is the Next 14.2+ standard.
  if (typeof permanentRedirect === 'function') {
    permanentRedirect(`/ot-management?${params.toString()}`);
  }
  redirect(`/ot-management?${params.toString()}`);
}
