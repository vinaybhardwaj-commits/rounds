'use client';
import { AdminShell } from '@/components/admin/AdminShell';
import { ComingSoon } from '@/components/admin/ComingSoon';

export default function ChatPage() {
  return (
    <AdminShell activeSection="chat">
      <ComingSoon
        title="Chat Analytics"
        description="Message volume, response times, and department communication patterns."
        phase="Phase 5"
      />
    </AdminShell>
  );
}
