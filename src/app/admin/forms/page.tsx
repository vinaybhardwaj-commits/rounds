'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function FormsPage() {
  return (
    <AdminShell activeSection="forms">
      <ComingSoon
        title="Form Analytics"
        description="Completion rates, drop-off analysis, and field-level insights across all department forms."
        phase="Phase 5"
      />
    </AdminShell>
  );
}
