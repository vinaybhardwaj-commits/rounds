import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { MessageSquare } from 'lucide-react';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  if (user.status !== 'active') {
    redirect('/auth/pending');
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'department_head';

  return (
    <div className="min-h-screen bg-even-white">
      {/* Simple header */}
      <header className="bg-even-navy text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-even-blue rounded-lg flex items-center justify-center">
            <span className="text-sm font-bold">R</span>
          </div>
          <span className="font-semibold">Rounds</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/60">{user.email}</span>
          <a
            href="/api/auth/logout"
            className="text-sm text-white/40 hover:text-white transition-colors"
          >
            Log out
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-col items-center justify-center min-h-[70vh] text-center p-6">
        <div className="w-16 h-16 bg-even-blue/10 rounded-2xl flex items-center justify-center mb-4">
          <MessageSquare size={32} className="text-even-blue" />
        </div>
        <h1 className="text-2xl font-bold text-even-navy mb-2">Welcome to Rounds</h1>
        <p className="text-gray-500 max-w-md mb-6">
          Your hospital communication hub is being set up. Messaging, groups, and
          real-time chat are coming soon.
        </p>

        {isAdmin && (
          <div className="flex gap-3 flex-wrap justify-center">
            <a
              href="/admin/approvals"
              className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              Pending Approvals
            </a>
            <a
              href="/admin/users"
              className="px-4 py-2 bg-even-blue text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Manage Users
            </a>
            <a
              href="/admin/profiles/import"
              className="px-4 py-2 bg-even-navy text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
            >
              Import Staff (CSV)
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
