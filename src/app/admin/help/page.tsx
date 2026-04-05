'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function HelpPage() {
  return (
    <AdminShell activeSection="help">
      <ComingSoon
        title="Help Analytics"
        description="Search patterns, knowledge gaps, and satisfaction scores from the Ask EHRC help system."
        phase="Phase 5"
      />
    </AdminShell>
  );
}
