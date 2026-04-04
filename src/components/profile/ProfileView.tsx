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
  Pencil,
  Check,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { LlmHealthIndicator } from '@/components/ai/LlmHealthIndicator';

interface ProfileData {
  profileId: string;
  id: string;
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMsg, setEditMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editDesignation, setEditDesignation] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.success) {
          setProfile(d.data);
          setEditName(d.data.full_name || '');
          setEditDesignation(d.data.designation || '');
          setEditPhone(d.data.phone || '');
          setError(null);
        } else {
          setError('Failed to load profile');
        }
      })
      .catch(err => {
        console.error('Failed to fetch profile:', err);
        setError('Could not load profile. Please refresh.');
      });
  }, []);

  const startEdit = () => {
    if (profile) {
      setEditName(profile.full_name || '');
      setEditDesignation(profile.designation || '');
      setEditPhone(profile.phone || '');
    }
    setEditMsg(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditMsg(null);
  };

  const saveEdit = async () => {
    setSaving(true);
    setEditMsg(null);
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editName || undefined,
          designation: editDesignation || undefined,
          phone: editPhone || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProfile(p => p ? {
          ...p,
          full_name: editName || p.full_name,
          designation: editDesignation || p.designation,
          phone: editPhone || p.phone,
        } : p);
        setEditing(false);
        setEditMsg({ type: 'success', text: 'Profile updated.' });
        setTimeout(() => setEditMsg(null), 3000);
      } else {
        setEditMsg({ type: 'error', text: data.error || 'Failed to save.' });
      }
    } catch {
      setEditMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-even-white">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-even-navy mb-4">Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Load error state */}
        {error && !profile && (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <X size={20} className="text-red-500" />
            </div>
            <p className="text-red-600 font-medium mb-3">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-even-blue hover:underline"
            >
              Refresh page
            </button>
          </div>
        )}

        {/* Edit success/error toast */}
        {editMsg && (
          <div className={`mb-3 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
            editMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {editMsg.type === 'success' ? <Check size={14} /> : <X size={14} />}
            {editMsg.text}
          </div>
        )}

        {/* Profile card */}
        {profile && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-even-blue/10 rounded-full flex items-center justify-center">
                <UserCircle size={32} className="text-even-blue" />
              </div>
              <div>
                {editing ? (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="font-semibold text-even-navy text-lg border-b border-even-blue/30 outline-none bg-transparent w-full"
                    placeholder="Full name"
                    autoFocus
                  />
                ) : (
                  <div className="font-semibold text-even-navy text-lg">
                    {profile?.full_name || profile?.email?.split('@')[0] || 'Loading...'}
                  </div>
                )}
                {editing ? (
                  <input
                    value={editDesignation}
                    onChange={e => setEditDesignation(e.target.value)}
                    className="text-sm text-gray-500 border-b border-gray-200 outline-none bg-transparent w-full mt-1"
                    placeholder="Designation (e.g., Senior Consultant)"
                  />
                ) : (
                  profile?.designation && (
                    <div className="text-sm text-gray-500">{profile.designation}</div>
                  )
                )}
                <div className="flex items-center gap-1 mt-0.5">
                  <Shield size={12} className="text-even-blue" />
                  <span className="text-xs text-even-blue font-medium">
                    {ROLE_LABELS[profile?.role || ''] || profile?.role || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit / Save / Cancel buttons */}
            {!editing ? (
              <button
                onClick={startEdit}
                className="p-2 text-gray-400 hover:text-even-blue hover:bg-even-blue/5 rounded-lg transition-colors"
                title="Edit profile"
              >
                <Pencil size={16} />
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Save"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={cancelEdit}
                  className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Cancel"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-3 text-sm">
              <Mail size={15} className="text-gray-400" />
              <span className="text-gray-600">{profile?.email || '—'}</span>
            </div>
            {editing ? (
              <div className="flex items-center gap-3 text-sm">
                <Phone size={15} className="text-gray-400" />
                <input
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  className="text-gray-600 border-b border-gray-200 outline-none bg-transparent flex-1"
                  placeholder="Phone number"
                />
              </div>
            ) : (
              profile?.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone size={15} className="text-gray-400" />
                  <span className="text-gray-600">{profile.phone}</span>
                </div>
              )
            )}
            {profile?.department_name && (
              <div className="flex items-center gap-3 text-sm">
                <Building2 size={15} className="text-gray-400" />
                <span className="text-gray-600">{profile.department_name}</span>
              </div>
            )}
          </div>
        </div>
        )}

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

        {/* AI Engine Status */}
        {isAdmin && (
          <div className="mb-4">
            <LlmHealthIndicator />
          </div>
        )}

        {/* App info */}
        <div className="text-center text-xs text-gray-300 mt-6">
          <p>Rounds v5 · Even Hospital Race Course</p>
          <p className="mt-0.5">Built for better patient communication</p>
        </div>
      </div>
    </div>
  );
}
