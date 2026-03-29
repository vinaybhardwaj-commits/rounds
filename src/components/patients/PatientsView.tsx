'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  ChevronRight,
  Activity,
  X,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import type { PatientStage } from '@/types';
import { PATIENT_STAGE_LABELS, PATIENT_STAGE_COLORS } from '@/types';

interface PatientThread {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: PatientStage;
  primary_consultant_name: string | null;
  department_name: string | null;
  getstream_channel_id: string;
  admission_date: string | null;
  created_at: string;
}

interface PatientsViewProps {
  onOpenPatient?: (patient: PatientThread) => void;
  onNavigateToChannel?: (channelId: string) => void;
}

export function PatientsView({ onOpenPatient, onNavigateToChannel }: PatientsViewProps) {
  const [patients, setPatients] = useState<PatientThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fName, setFName] = useState('');
  const [fUhid, setFUhid] = useState('');
  const [fStage, setFStage] = useState<PatientStage>('opd');

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (stageFilter) params.set('stage', stageFilter);
      const res = await fetch(`/api/patients?${params.toString()}`);
      const data = await res.json();
      if (data.success) setPatients(data.data || []);
    } catch (err) {
      console.error('Failed to fetch patients:', err);
    } finally {
      setLoading(false);
    }
  }, [stageFilter]);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);

  const filtered = search
    ? patients.filter(p =>
        p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
        p.uhid?.toLowerCase().includes(search.toLowerCase()) ||
        p.ip_number?.toLowerCase().includes(search.toLowerCase())
      )
    : patients;

  const handleCreate = async () => {
    setMsg(null);
    if (!fName) { setMsg({ type: 'error', text: 'Patient name is required.' }); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: fName,
          uhid: fUhid || null,
          current_stage: fStage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: 'Patient thread created.' });
        setShowCreate(false);
        setFName(''); setFUhid(''); setFStage('opd');
        fetchPatients();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to create.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-even-navy">Patients</h1>
          <button
            onClick={() => { setMsg(null); setShowCreate(true); }}
            className="w-9 h-9 flex items-center justify-center bg-even-blue text-white rounded-full shadow-md hover:bg-even-navy transition-colors"
            title="Create patient thread"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, UHID, or IP number..."
            className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-even-blue/30"
          />
        </div>

        {/* Stage filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setStageFilter('')}
            className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
              !stageFilter ? 'bg-even-blue text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            All
          </button>
          {(Object.entries(PATIENT_STAGE_LABELS) as [PatientStage, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStageFilter(key)}
              className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                stageFilter === key
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-500'
              }`}
              style={stageFilter === key ? { backgroundColor: PATIENT_STAGE_COLORS[key] } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      {msg && !showCreate && (
        <div className={`mx-4 mb-2 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {msg.text}
        </div>
      )}

      {/* Patient list */}
      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading patients...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Activity size={40} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 font-medium text-sm">
              {search ? 'No patients match your search' : 'No patient threads yet'}
            </p>
            <p className="text-gray-400 text-xs mt-1">
              {search
                ? 'Try a different name, UHID, or IP number'
                : 'Tap the + button to create a patient thread. Any staff member can start one.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(patient => {
              const stageColor = PATIENT_STAGE_COLORS[patient.current_stage];
              return (
                <button
                  key={patient.id}
                  onClick={() => {
                    if (onOpenPatient) onOpenPatient(patient);
                    else if (onNavigateToChannel) onNavigateToChannel(patient.getstream_channel_id);
                  }}
                  className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow text-left"
                >
                  {/* Stage indicator */}
                  <div
                    className="w-1 h-12 rounded-full shrink-0"
                    style={{ backgroundColor: stageColor }}
                  />

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-even-navy truncate">
                        {patient.patient_name}
                      </span>
                      <span
                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: stageColor }}
                      >
                        {PATIENT_STAGE_LABELS[patient.current_stage]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                      {patient.uhid && <span>{patient.uhid}</span>}
                      {patient.ip_number && <span>IP: {patient.ip_number}</span>}
                    </div>
                    {patient.primary_consultant_name && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        {patient.primary_consultant_name} &middot; {patient.department_name || ''}
                      </div>
                    )}
                  </div>

                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-0 sm:mx-4 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-even-navy">New Patient Thread</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name *</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" placeholder="Full name" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UHID</label>
                <input type="text" value={fUhid} onChange={e => setFUhid(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" placeholder="KX-2026-001 (optional)" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starting Stage</label>
                <select value={fStage} onChange={e => setFStage(e.target.value as PatientStage)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
                  {(Object.entries(PATIENT_STAGE_LABELS) as [PatientStage, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {msg && showCreate && (
                <div className={`p-2.5 rounded-lg flex items-center gap-2 text-xs ${
                  msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {msg.text}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-200">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={saving}
                className="flex-1 px-4 py-2.5 text-sm bg-even-blue text-white rounded-lg disabled:opacity-50">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
