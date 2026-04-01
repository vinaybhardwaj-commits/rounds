'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Hash, Users, RefreshCw, Play, Loader2,
  CheckCircle2, AlertTriangle, Plus, Building2
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

interface ChannelStats {
  totalPatientChannels: number;
  orphanPatients: number;
  departmentChannels: number;
  totalDepartments: number;
  crossFunctionalChannels: number;
}

export default function ChatSystemAdmin() {
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Action states
  const [seedingChannels, setSeedingChannels] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  // Group chat creation
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupResult, setGroupResult] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/getstream/stats');
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadStats().finally(() => setLoading(false));
  }, [loadStats]);

  // Seed department + cross-functional channels
  const handleSeedChannels = async () => {
    setSeedingChannels(true);
    setSeedResult(null);
    try {
      const res = await fetch('/api/admin/getstream/seed-channels', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSeedResult(`${data.message}. ${data.data.log.length} channels processed.`);
      } else {
        setSeedResult(`Failed: ${data.error}`);
      }
      await loadStats();
    } catch (err) {
      setSeedResult(`Error: ${err}`);
    } finally {
      setSeedingChannels(false);
    }
  };

  // Backfill patient channels
  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/admin/getstream/backfill-patient-channels', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBackfillResult(data.message);
      } else {
        setBackfillResult(`Failed: ${data.error}`);
      }
      await loadStats();
    } catch (err) {
      setBackfillResult(`Error: ${err}`);
    } finally {
      setBackfilling(false);
    }
  };

  // Create group chat
  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    setCreatingGroup(true);
    setGroupResult(null);
    try {
      const res = await fetch('/api/admin/getstream/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGroupResult(`Group "${data.data.name}" created (${data.data.members_added} members added)`);
        setGroupName('');
        setGroupDescription('');
        setShowCreateGroup(false);
      } else {
        setGroupResult(`Failed: ${data.error}`);
      }
    } catch (err) {
      setGroupResult(`Error: ${err}`);
    } finally {
      setCreatingGroup(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout breadcrumbs={[{ label: 'Admin Dashboard', href: '/admin' }, { label: 'Chat System' }]}>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="animate-spin text-even-blue" size={32} />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin Dashboard', href: '/admin' }, { label: 'Chat System Setup' }]}>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Chat System Setup</h1>
            <p className="text-sm text-gray-500 mt-1">Manage department channels, patient threads, and group chats</p>
          </div>
          <button
            onClick={loadStats}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={18} className="text-even-blue" />
                <span className="text-xs text-gray-500">Dept Channels</span>
              </div>
              <div className="text-2xl font-bold text-even-navy">{stats.departmentChannels}</div>
              <div className="text-xs text-gray-400 mt-1">of {stats.totalDepartments} departments</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={18} className="text-teal-500" />
                <span className="text-xs text-gray-500">Patient Chats</span>
              </div>
              <div className="text-2xl font-bold text-even-navy">{stats.totalPatientChannels}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={18} className="text-orange-500" />
                <span className="text-xs text-gray-500">No Chat Channel</span>
              </div>
              <div className={`text-2xl font-bold ${stats.orphanPatients > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {stats.orphanPatients}
              </div>
              <div className="text-xs text-gray-400 mt-1">patients without chat</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Hash size={18} className="text-purple-500" />
                <span className="text-xs text-gray-500">Cross-Functional</span>
              </div>
              <div className="text-2xl font-bold text-even-navy">{stats.crossFunctionalChannels}</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-4">
          {/* 1. Seed Department Channels */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Building2 size={20} className="text-even-blue" />
                </div>
                <div>
                  <h3 className="font-semibold text-even-navy">Seed Department & System Channels</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Creates a <span className="font-mono text-xs bg-gray-100 px-1 rounded">#department-name</span> channel for every active department,
                    plus cross-functional channels (Ops Huddle, Admission Coord, etc.) and the hospital broadcast channel.
                    Idempotent — safe to run multiple times.
                  </p>
                </div>
              </div>
              <button
                onClick={handleSeedChannels}
                disabled={seedingChannels}
                className="flex items-center gap-2 px-4 py-2 bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors disabled:opacity-50 shrink-0"
              >
                {seedingChannels ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {seedingChannels ? 'Seeding...' : 'Seed Channels'}
              </button>
            </div>
            {seedResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${seedResult.includes('Failed') || seedResult.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <CheckCircle2 size={14} className="inline mr-1" /> {seedResult}
              </div>
            )}
          </div>

          {/* 2. Backfill Patient Channels */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <MessageSquare size={20} className="text-orange-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-even-navy">Backfill Patient Chat Channels</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Creates GetStream chat channels for all active patients that don't have one yet.
                    {stats && stats.orphanPatients > 0 && (
                      <span className="text-orange-600 font-medium"> {stats.orphanPatients} patients need channels.</span>
                    )}
                    {stats && stats.orphanPatients === 0 && (
                      <span className="text-green-600 font-medium"> All patients have channels.</span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={handleBackfill}
                disabled={backfilling || (stats?.orphanPatients === 0)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 shrink-0"
              >
                {backfilling ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {backfilling ? 'Creating...' : 'Backfill Channels'}
              </button>
            </div>
            {backfillResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${backfillResult.includes('Failed') || backfillResult.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <CheckCircle2 size={14} className="inline mr-1" /> {backfillResult}
              </div>
            )}
          </div>

          {/* 3. Create Group Chat */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Users size={20} className="text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-even-navy">Create Group Chat</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Create a new group chat visible to all staff. Good for project groups, committees, or ad-hoc coordination channels.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateGroup(!showCreateGroup)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shrink-0"
              >
                <Plus size={16} />
                New Group
              </button>
            </div>

            {showCreateGroup && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="e.g., Quality Committee"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={groupDescription}
                    onChange={e => setGroupDescription(e.target.value)}
                    placeholder="e.g., Weekly quality review discussions"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateGroup}
                    disabled={creatingGroup || !groupName.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 text-sm"
                  >
                    {creatingGroup ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {creatingGroup ? 'Creating...' : 'Create Group'}
                  </button>
                  <button
                    onClick={() => { setShowCreateGroup(false); setGroupName(''); setGroupDescription(''); }}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {groupResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${groupResult.includes('Failed') || groupResult.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <CheckCircle2 size={14} className="inline mr-1" /> {groupResult}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
