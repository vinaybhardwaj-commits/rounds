'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function APIPerformancePage() {
  return (
    <AdminShell activeSection="api-performance">
      <ComingSoon
        title="API Performance"
        description="Endpoint latency percentiles, throughput, error rates, and slow query identification."
        phase="Phase 4"
      />
    </AdminShell>
  );
}
