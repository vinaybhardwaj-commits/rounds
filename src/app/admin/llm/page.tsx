'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function LLMPage() {
  return (
    <AdminShell activeSection="llm">
      <ComingSoon
        title="LLM Observatory"
        description="Token usage, latency percentiles, prompt/response logs, and model health monitoring."
        phase="Phase 4"
      />
    </AdminShell>
  );
}
