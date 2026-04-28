// =============================================================================
// /ot-management — top-level URL for OT Management Module v1 (OT.1)
//
// Server-side redirects to / with ?tab=ot, preserving patient_id query.
// AppShell parses ?tab on mount and switches the active bottom-nav tab.
//
// Why redirect rather than render the module here?
// • The module is meant to live inside the AppShell so the bottom nav
//   remains visible (Patients · Chat · Forms · Tasks · OT · Me).
// • A standalone /ot-management page would lose the bottom nav and break
//   the "tap a patient to jump to Patients tab" cross-module flows.
// • PRD §6.4 entry-point updates in OT.4 will point all 5 deep-links here;
//   this redirect makes the URL canonical from day one.
//
// Tolerates both ?patient= (legacy /ot-calendar query) and ?patient_id= (new
// canonical name) so links from /ot-calendar work without further patching.
// =============================================================================

import { redirect } from 'next/navigation';

export default function OTManagementRedirectPage({
  searchParams,
}: {
  searchParams: { patient_id?: string; patient?: string; tab?: string };
}) {
  const patientId = searchParams.patient_id || searchParams.patient || '';
  const params = new URLSearchParams();
  params.set('tab', 'ot');
  if (patientId) params.set('patient_id', patientId);
  redirect(`/?${params.toString()}`);
}
