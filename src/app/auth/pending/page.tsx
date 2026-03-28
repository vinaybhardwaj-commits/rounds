'use client';

import { Clock } from 'lucide-react';

export default function PendingPage() {
  return (
    <div className="min-h-screen bg-even-navy flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Clock size={32} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-even-white mb-2">Account Pending</h1>
        <p className="text-white/60 mb-6">
          Your account is waiting for admin approval. Please check back later or contact the administrator.
        </p>
        <div className="flex gap-3 justify-center">
          <a
            href="/api/auth/logout"
            className="px-5 py-2.5 bg-white/10 text-white rounded-xl text-sm font-medium hover:bg-white/20 transition-colors"
          >
            Log Out
          </a>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-even-blue text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Check Again
          </button>
        </div>
      </div>
    </div>
  );
}
