'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function ErrorsPage() {
  return (
    <AdminShell activeSection="errors">
      <ComingSoon
        title="Error Forensics"
        description="Error clustering, stack traces, affected user counts, and resolution tracking."
        phase="Phase 4"
      />
    </AdminShell>
  );
}
