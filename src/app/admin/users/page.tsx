'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Search, RefreshCw, Shield, Clock, Ban, CheckCircle, Pencil } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ProfileEditModal } from '@/components/admin/ProfileEditModal';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  designation: string | null;
  phone: string | null;
  department_name: string | null;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  active: { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle size={12} /> },
  pending_approval: { bg: 'bg-amber-100', text: 'text-amber-700', icon: <Clock size={12} /> },
  suspended: { bg: 'bg-red-100', text: 'text-red-700', icon: <Ban size={12} /> },
  rejected: { bg: 'bg-gray-100', text: 'text-gray-500', icon: <Ban size={12} /> },
};

const ROLE_BADGE: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  department_head: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600',
  pac_coordinator: 'bg-teal-100 text-teal-700',
  marketing: 'bg-pink-100 text-pink-700',
  marketing_executive: 'bg-pink-100 text-pink-700',
  administrator: 'bg-indigo-100 text-indigo-700',
  medical_administrator: 'bg-indigo-100 text-indigo-700',
  operations_manager: 'bg-sky-100 text-sky-700',
  unit_head: 'bg-cyan-100 text-cyan-700',
  guest: 'bg-orange-100 text-orange-700',
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success) setCurrentUser({ id: d.data.id, role: d.data.role }); })
      .catch(() => {});
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '100');

      const res = await fetch(`/api/profiles?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
        setTotalCount(data.pagination?.total || data.data.length);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'All Users'}]}>
      <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy flex items-center gap-2">
            <Users size={24} /> All Users
          </h1>
          <p className="text-gray-500 text-sm mt-1">{totalCount} total users</p>
        </div>
        <div className="flex gap-3">
          <a
            href="/admin/approvals"
            className="flex items-center gap-2 px-3 py-2 text-sm border border-amber-300 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors"
          >
            <Shield size={16} /> Approvals
          </a>
          <button
            onClick={fetchUsers}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending_approval">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Last Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => {
                  const badge = STATUS_BADGE[user.status] || STATUS_BADGE.active;
                  const roleBg = ROLE_BADGE[user.role] || ROLE_BADGE.staff;
                  return (
                    <tr
                      key={user.id}
                      onClick={() => setEditingProfileId(user.id)}
                      className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-even-navy">{user.full_name}</div>
                          <Pencil size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        {user.designation && (
                          <div className="text-xs text-gray-400">{user.designation}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${roleBg}`}>
                          {user.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                          {badge.icon} {user.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {user.department_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {formatDate(user.last_login_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* Profile Edit Modal */}
      {editingProfileId && (
        <ProfileEditModal
          profileId={editingProfileId}
          onClose={() => setEditingProfileId(null)}
          onSaved={() => fetchUsers()}
          currentUserRole={currentUser?.role}
          currentUserId={currentUser?.id}
        />
      )}
    </AdminLayout>
  );
}
