// =============================================================================
// /ot-management — top-level URL for OT Management Module v1
//
// Server-side redirects to / with ?tab=ot, preserving patient_id query and
// translating tab={section} → section={section} so OTManagementView can
// scroll to a specific section (e.g. ?tab=week → opens the OT tab and
// scrolls to the Week View section).
//
// Why redirect rather than render the module here?
// • The module is meant to live inside the AppShell so the bottom nav
//   remains visible (Patients · Chat · Forms · Tasks · OT · Me).
// • A standalone /ot-management page would lose the bottom nav and break
//   cross-module flows.
// =============================================================================

import { redirect } from 'next/navigation';

export default function OTManagementRedirectPage({
  searchParams,
}: {
  searchParams: { patient_id?: string; patient?: string; tab?: string; section?: string };
}) {
  const patientId = searchParams.patient_id || searchParams.patient || '';
  // tab=week / tab=slate / tab=inbox / etc. → section so AppShell still
  // routes the outer 'tab' to the OT bottom-nav tab.
  const section = searchParams.section || searchParams.tab || '';

  const params = new URLSearchParams();
  params.set('tab', 'ot');
  if (patientId) params.set('patient_id', patientId);
  if (section) params.set('section', section);
  redirect(`/?${params.toString()}`);
}
