'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';

interface PendingUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  designation: string;
  phone: string;
  department_name: string | null;
  created_at: string;
}

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/approvals');
      const data = await res.json();
      if (data.success) setPending(data.data);
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleAction = async (profileId: string, action: 'approve' | 'reject') => {
    setActionLoading(profileId);
    try {
      const res = await fetch('/api/admin/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, action }),
      });
      const data = await res.json();
      if (data.success) {
        setPending(prev => prev.filter(p => p.id !== profileId));
      }
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Pending Approvals</h1>
          <p className="text-gray-500 text-sm mt-1">Review and approve new staff registrations</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchPending}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <a
            href="/admin/users"
            className="flex items-center gap-2 px-3 py-2 text-sm bg-even-navy text-white rounded-lg hover:bg-opacity-90 transition-colors"
          >
            All Users
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-12">
          <Clock size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No pending approvals</p>
          <p className="text-gray-400 text-sm mt-1">New signups will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(user => (
            <div
              key={user.id}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-even-navy truncate">{user.full_name}</h3>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                    Pending
                  </span>
                </div>
                <p className="text-sm text-gray-500 truncate">{user.email}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-400">
                  {user.designation && <span>{user.designation}</span>}
                  {user.department_name && <span>| {user.department_name}</span>}
                  {user.phone && <span>| {user.phone}</span>}
                  <span>| Signed up {new Date(user.created_at).toLocaleDateString('en-IN')}</span>
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleAction(user.id, 'approve')}
                  disabled={actionLoading === user.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={16} /> Approve
                </button>
                <button
                  onClick={() => handleAction(user.id, 'reject')}
                  disabled={actionLoading === user.id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  <XCircle size={16} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
