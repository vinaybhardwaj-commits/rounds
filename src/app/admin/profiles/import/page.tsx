'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { CSVImport } from '@/components/admin/CSVImport';
import { useState } from 'react';

export default function ImportPage() {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const user = session?.user as Record<string, unknown> | undefined;

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!session) redirect('/auth/signin');
  if (user?.role !== 'super_admin') redirect('/');

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 p-6">
          <CSVImport />
        </main>
      </div>
    </div>
  );
}
