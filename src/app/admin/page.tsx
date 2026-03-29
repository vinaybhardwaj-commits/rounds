'use client';

import { useState, useEffect } from 'react';
import { Users, Building2, Upload, Shield, UserCheck, Calendar, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface Stats {
  profiles: number;
  departments: number;
  pending: number;
  rosterEntries: number;
  openEscalations: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ profiles: 0, departments: 0, pending: 0, rosterEntries: 0, openEscalations: 0 });

  useEffect(() => {
    fetch('/api/profiles?limit=1')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, profiles: d.pagination.total })); })
      .catch(() => {});
    fetch('/api/departments')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, departments: d.data.length })); })
      .catch(() => {});
    fetch('/api/admin/approvals')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, pending: d.data.length })); })
      .catch(() => {});
    fetch('/api/duty-roster?active_only=true')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, rosterEntries: d.data?.length || 0 })); })
      .catch(() => {});
    fetch('/api/escalation/log?resolved=false')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, openEscalations: d.data?.length || 0 })); })
      .catch(() => {});
  }, []);

  const cards = [
    { label: 'Pending Approvals', value: stats.pending, icon: UserCheck, href: '/admin/approvals', color: 'bg-amber-500' },
    { label: 'Total Users', value: stats.profiles, icon: Users, href: '/admin/users', color: 'bg-even-blue' },
    { label: 'Departments', value: stats.departments, icon: Building2, href: '/admin/departments', color: 'bg-even-navy' },
    { label: 'Duty Roster', value: stats.rosterEntries, icon: Calendar, href: '/admin/duty-roster', color: 'bg-teal-600' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-even-navy mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 ${card.color} rounded-lg flex items-center justify-center`}>
                  <Icon size={20} className="text-white" />
                </div>
                <span className="text-sm text-gray-500">{card.label}</span>
              </div>
              <span className="text-2xl font-bold text-even-navy">{card.value}</span>
            </Link>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-even-navy mb-4">Quick Actions</h2>
        <div className="space-y-3">
          <Link href="/admin/approvals" className="flex items-center gap-3 px-4 py-3 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
            <UserCheck size={18} className="text-amber-600" />
            <div>
              <div className="text-sm font-medium">Review Pending Signups</div>
              <div className="text-xs text-gray-500">Approve or reject new staff registrations</div>
            </div>
            {stats.pending > 0 && (
              <span className="ml-auto bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{stats.pending}</span>
            )}
          </Link>
          <Link href="/admin/profiles/import" className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <Upload size={18} className="text-even-blue" />
            <div>
              <div className="text-sm font-medium">Bulk Import Staff</div>
              <div className="text-xs text-gray-500">Upload a CSV with email, name, department, role</div>
            </div>
          </Link>
          <Link href="/admin/users" className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            <Shield size={18} className="text-even-blue" />
            <div>
              <div className="text-sm font-medium">Manage Users</div>
              <div className="text-xs text-gray-500">View all users, roles, and account status</div>
            </div>
          </Link>
          <Link href="/admin/duty-roster" className="flex items-center gap-3 px-4 py-3 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors">
            <Calendar size={18} className="text-teal-600" />
            <div>
              <div className="text-sm font-medium">Duty Roster</div>
              <div className="text-xs text-gray-500">Assign staff to shifts, manage overrides, resolve on-duty</div>
            </div>
            {stats.rosterEntries > 0 && (
              <span className="ml-auto bg-teal-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{stats.rosterEntries}</span>
            )}
          </Link>
          <Link href="/admin/escalations" className="flex items-center gap-3 px-4 py-3 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            <AlertTriangle size={18} className="text-red-600" />
            <div>
              <div className="text-sm font-medium">Escalation Log</div>
              <div className="text-xs text-gray-500">View open escalations, run overdue checks, resolve issues</div>
            </div>
            {stats.openEscalations > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{stats.openEscalations}</span>
            )}
          </Link>
        </div>
      </div>
    </div>
  );
}
