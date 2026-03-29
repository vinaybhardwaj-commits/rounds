'use client';

import { useState, useEffect } from 'react';
import {
  UserCircle,
  Shield,
  Building2,
  Mail,
  Phone,
  LogOut,
  Settings,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface ProfileData {
  profileId: string;
  email: string;
  full_name: string;
  role: string;
  department_name?: string;
  designation?: string;
  phone?: string;
}

interface ProfileViewProps {
  isAdmin?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  department_head: 'Department Head',
  ip_coordinator: 'IP Coordinator',
  nurse: 'Nurse',
  anesthesiologist: 'Anesthesiologist',
  ot_coordinator: 'OT Coordinator',
  billing_executive: 'Billing Executive',
  insurance_coordinator: 'Insurance Coordinator',
  pharmacist: 'Pharmacist',
  physiotherapist: 'Physiotherapist',
  marketing_executive: 'Marketing Executive',
  clinical_care: 'Clinical Care',
  pac_coordinator: 'PAC Coordinator',
  staff: 'Staff',
  guest: 'Guest',
};

export function ProfileView({ isAdmin = false }: ProfileViewProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success) setProfile(d.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full bg-even-white">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-even-navy mb-4">Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {/* Profile card */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-even-blue/10 rounded-full flex items-center justify-center">
              <UserCircle size={32} className="text-even-blue" />
            </div>
            <div>
              <div className="font-semibold text-even-navy text-lg">
                {profile?.full_name || profile?.email?.split('@')[0] || 'Loading...'}
              </div>
              {profile?.designation && (
                <div className="text-sm text-gray-500">{profile.designation}</div>
              )}
              <div className="flex items-center gap-1 mt-0.5">
                <Shield size={12} className="text-even-blue" />
                <span className="text-xs text-even-blue font-medium">
                  {ROLE_LABELS[profile?.role || ''] || profile?.role || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-3 text-sm">
              <Mail size={15} className="text-gray-400" />
              <span className="text-gray-600">{profile?.email || '—'}</span>
            </div>
            {profile?.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone size={15} className="text-gray-400" />
                <span className="text-gray-600">{profile.phone}</span>
              </div>
            )}
            {profile?.department_name && (
              <div className="flex items-center gap-3 text-sm">
                <Building2 size={15} className="text-gray-400" />
                <span className="text-gray-600">{profile.department_name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Navigation links */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <Settings size={18} className="text-gray-500" />
              <span className="flex-1 text-sm font-medium text-even-navy">Admin Dashboard</span>
              <ChevronRight size={16} className="text-gray-300" />
            </Link>
          )}
          <a
            href="/api/auth/logout"
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 transition-colors"
          >
            <LogOut size={18} className="text-red-500" />
            <span className="flex-1 text-sm font-medium text-red-600">Log Out</span>
          </a>
        </div>

        {/* App info */}
        <div className="text-center text-xs text-gray-300 mt-6">
          <p>Rounds v5 · Even Hospital Race Course</p>
          <p className="mt-0.5">Built for better patient communication</p>
        </div>
      </div>
    </div>
  );
}
