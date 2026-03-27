'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import Link from 'next/link';
import type { Profile } from '@/types';

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function ProfilesTable() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 50, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (search) params.set('search', search);
    if (roleFilter) params.set('role', roleFilter);

    const res = await fetch(`/api/profiles?${params}`);
    const data = await res.json();
    if (data.success) {
      setProfiles(data.data);
      setPagination(data.pagination);
    }
    setLoading(false);
  }, [search, roleFilter]);

  useEffect(() => {
    fetchProfiles(1);
  }, [fetchProfiles]);

  const roleBadgeColor: Record<string, string> = {
    super_admin: 'bg-red-100 text-red-700',
    department_head: 'bg-blue-100 text-blue-700',
    staff: 'bg-gray-100 text-gray-600',
    pac_coordinator: 'bg-purple-100 text-purple-700',
    marketing: 'bg-pink-100 text-pink-700',
    guest: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Profiles</h1>
          <p className="text-sm text-gray-500">{pagination.total} staff members</p>
        </div>
        <Link
          href="/admin/profiles/import"
          className="flex items-center gap-2 px-4 py-2 bg-even-blue text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Upload size={16} />
          Import CSV
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue/30"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="department_head">Dept Head</option>
          <option value="staff">Staff</option>
          <option value="pac_coordinator">PAC Coordinator</option>
          <option value="marketing">Marketing</option>
          <option value="guest">Guest</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 font-medium text-gray-500">Department</th>
                <th className="px-4 py-3 font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 font-medium text-gray-500">Designation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td>
                </tr>
              ) : profiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No profiles found. <Link href="/admin/profiles/import" className="text-even-blue underline">Import staff via CSV</Link>
                  </td>
                </tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-even-blue/10 flex items-center justify-center text-xs font-bold text-even-blue">
                            {p.full_name.charAt(0)}
                          </div>
                        )}
                        <span className="font-medium text-gray-900">{p.full_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.email}</td>
                    <td className="px-4 py-3 text-gray-600">{p.department_name || '\u2014'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadgeColor[p.role] || 'bg-gray-100 text-gray-600'}`}>
                        {p.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.designation || '\u2014'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Page {pagination.page} of {pagination.pages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => fetchProfiles(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => fetchProfiles(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
