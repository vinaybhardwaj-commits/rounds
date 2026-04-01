'use client';

import { useState, useEffect } from 'react';
import { Users, Building2, Upload, Shield, UserCheck, Calendar, AlertTriangle, Activity, UserPlus, ClipboardList, Link2 } from 'lucide-react';
import Link from 'next/link';
import { AdminLayout } from '@/components/admin/AdminLayout';

interface Stats {
  profiles: number;
  departments: number;
  pending: number;
  rosterEntries: number;
  openEscalations: number;
  activeAdmissions: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ profiles: 0, departments: 0, pending: 0, rosterEntries: 0, openEscalations: 0, activeAdmissions: 0 });

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
    fetch('/api/admission-tracker')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(s => ({ ...s, activeAdmissions: d.data?.length || 0 })); })
      .catch(() => {});
  }, []);

  const cards = [
    { label: 'Pending Approvals', value: stats.pending, icon: UserCheck, href: '/admin/approvals', color: 'bg-amber-500' },
    { label: 'Total Users', value: stats.profiles, icon: Users, href: '/admin/users', color: 'bg-even-blue' },
    { label: 'Departments', value: stats.departments, icon: Building2, href: '/admin/departments', color: 'bg-even-navy' },
    { label: 'Duty Roster', value: stats.rosterEntries, icon: Calendar, href: '/admin/duty-roster', color: 'bg-teal-600' },
  ];

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin Dashboard' }]}>
      <div className="p-6">
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
            <Link href="/admin/profiles/add" className="flex items-center gap-3 px-4 py-3 bg-green-50 rounded-lg hover:bg-green-100 transition-colors">
              <UserPlus size={18} className="text-green-600" />
              <div>
                <div className="text-sm font-medium">Add Staff Member</div>
                <div className="text-xs text-gray-500">Create a single staff account with name, email, department, role</div>
              </div>
            </Link>
            <Link href="/admin/profiles/import" className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <Upload size={18} className="text-even-blue" />
              <div>
                <div className="text-sm font-medium">Bulk Import Staff</div>
                <div className="text-xs text-gray-500">Download template, fill in, upload CSV</div>
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
            <Link href="/admin/admissions" className="flex items-center gap-3 px-4 py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              <Activity size={18} className="text-even-blue" />
              <div>
                <div className="text-sm font-medium">Admission Tracker</div>
                <div className="text-xs text-gray-500">Active admissions, surgery schedule, discharge readiness</div>
              </div>
              {stats.activeAdmissions > 0 && (
                <span className="ml-auto bg-even-blue text-white text-xs font-bold px-2 py-0.5 rounded-full">{stats.activeAdmissions}</span>
              )}
            </Link>
            <Link href="/admin/changelog" className="flex items-center gap-3 px-4 py-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
              <ClipboardList size={18} className="text-purple-600" />
              <div>
                <div className="text-sm font-medium">Patient Changelog</div>
                <div className="text-xs text-gray-500">Full history of changes, messages, and forms per patient</div>
              </div>
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
            <Link href="/admin/leadsquared" className="flex items-center gap-3 px-4 py-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
              <Link2 size={18} className="text-indigo-600" />
              <div>
                <div className="text-sm font-medium">LeadSquared Integration</div>
                <div className="text-xs text-gray-500">Sync logs, API call traceability, patient imports from LSQ</div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
