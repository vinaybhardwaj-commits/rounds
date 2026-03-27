'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { DepartmentList } from '@/components/admin/DepartmentList';
import { useState } from 'react';

export default function DepartmentsPage() {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const user = session?.user as Record<string, unknown> | undefined;
  const isAdmin = user?.role === 'super_admin' || user?.role === 'department_head';

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!session) redirect('/auth/signin');
  if (!isAdmin) redirect('/');

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 p-6">
          <DepartmentList />
        </main>
      </div>
    </div>
  );
}
