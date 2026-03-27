'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { useState, useEffect } from 'react';
import { Users, Building2, Upload, Shield } from 'lucide-react';
import Link from 'next/link';

interface Stats {
  profiles: number;
  departments: number;
}

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState<Stats>({ profiles: 0, departments: 0 });

  const user = session?.user as Record<string, unknown> | undefined;
  const isAdmin = user?.role === 'super_admin' || user?.role === 'department_head';

  useEffect(() => {
    if (session && isAdmin) {
      // Fetch profile count
      fetch('/api/profiles?limit=1')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) setStats((s) => ({ ...s, profiles: d.pagination.total }));
        });
      // Fetch department count
      fetch('/api/departments')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) setStats((s) => ({ ...s, departments: d.data.length }));
        });
    }
  }, [session, isAdmin]);

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!session) redirect('/auth/signin');
  if (!isAdmin) redirect('/');

  const cards = [
    {
      label: 'Total Profiles',
      value: stats.profiles,
      icon: Users,
      href: '/admin/profiles',
      color: 'bg-even-blue',
    },
    {
      label: 'Departments',
      value: stats.departments,
      icon: Building2,
      href: '/admin/departments',
      color: 'bg-even-navy',
    },
    {
      label: 'CSV Import',
      value: 'Import',
      icon: Upload,
      href: '/admin/profiles/import',
      color: 'bg-even-green',
    },
    {
      label: 'Roles & Access',
      value: 'Manage',
      icon: Shield,
      href: '/admin/profiles?filter=roles',
      color: 'bg-even-purple',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 p-6">
          <h1 className="text-2xl font-bold text-even-navy mb-6">Admin Dashboard</h1>

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {cards.map((card) => {
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

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-even-navy mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link
                href="/admin/profiles/import"
                className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Upload size={18} className="text-even-blue" />
                <div>
                  <div className="text-sm font-medium">Bulk Import Staff</div>
                  <div className="text-xs text-gray-500">Upload a CSV with email, name, department, role</div>
                </div>
              </Link>
              <Link
                href="/admin/departments"
                className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Building2 size={18} className="text-even-blue" />
                <div>
                  <div className="text-sm font-medium">Manage Departments</div>
                  <div className="text-xs text-gray-500">View and edit the 17 EHRC departments</div>
                </div>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
