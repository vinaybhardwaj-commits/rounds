'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function DatabasePage() {
  return (
    <AdminShell activeSection="database">
      <ComingSoon
        title="Database Explorer"
        description="Table browser, row counts, query runner, and schema documentation."
        phase="Phase 4"
      />
    </AdminShell>
  );
}
