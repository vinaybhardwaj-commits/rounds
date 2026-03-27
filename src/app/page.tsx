'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';

export default function HomePage() {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-even-white">
        <div className="animate-pulse text-even-navy text-lg font-medium">Loading Rounds...</div>
      </div>
    );
  }

  if (!session) {
    redirect('/auth/signin');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 p-6">
          {/* Placeholder — messaging UI comes in Week 3-4 */}
          <div className="flex flex-col items-center justify-center h-[60vh] text-center">
            <div className="w-16 h-16 bg-even-blue/10 rounded-2xl flex items-center justify-center mb-4">
              <MessageSquare size={32} className="text-even-blue" />
            </div>
            <h1 className="text-2xl font-bold text-even-navy mb-2">Welcome to Rounds</h1>
            <p className="text-gray-500 max-w-md">
              Your hospital communication hub is being set up. Messaging, groups, and
              real-time chat are coming soon.
            </p>
            <div className="mt-6 flex gap-3">
              <a
                href="/admin"
                className="px-4 py-2 bg-even-blue text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Go to Admin Panel
              </a>
              <a
                href="/admin/profiles/import"
                className="px-4 py-2 bg-even-navy text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
              >
                Import Staff (CSV)
              </a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
