'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Search,
  ChevronRight,
  Activity,
  X,
  AlertCircle,
  CheckCircle,
  Upload,
  FileSpreadsheet,
  MessageCircle,
} from 'lucide-react';
import type { PatientStage, FormType } from '@/types';
import { PATIENT_STAGE_LABELS, PATIENT_STAGE_COLORS } from '@/types';
import { FORMS_BY_STAGE, FORM_TYPE_LABELS } from '@/lib/form-registry';

type CreateTab = 'single' | 'upload';

interface PatientThread {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: PatientStage;
  primary_consultant_name: string | null;
  department_name: string | null;
  primary_diagnosis: string | null;
  getstream_channel_id: string;
  admission_date: string | null;
  created_at: string;
  // From admission_tracker JOIN
  bed_number: string | null;
  room_number: string | null;
  room_category: string | null;
  financial_category: string | null;
}

interface PatientsViewProps {
  onOpenPatient?: (patient: PatientThread) => void;
  onNavigateToChannel?: (channelId: string) => void;
}

// Short labels for chiclets (save horizontal space)
const CHICLET_LABELS: Partial<Record<FormType, string>> = {
  marketing_cc_handoff: 'CC Handoff',
  admission_advice: 'Adm Advice',
  financial_counseling: 'Fin Counsel',
  ot_billing_clearance: 'OT Billing',
  admission_checklist: 'Adm Checklist',
  surgery_posting: 'Surgery Post',
  pre_op_nursing_checklist: 'Pre-Op Nrsg',
  who_safety_checklist: 'WHO Safety',
  nursing_shift_handoff: 'Shift Handoff',
  discharge_readiness: 'Discharge',
  post_discharge_followup: 'Post-DC F/U',
  daily_department_update: 'Dept Update',
  pac_clearance: 'PAC',
};

function getChicletLabel(formType: FormType): string {
  return CHICLET_LABELS[formType] || FORM_TYPE_LABELS[formType] || formType;
}

// Chiclet status dot color
function getStatusColor(status: string | undefined): { bg: string; border: string; dotClass: string } {
  switch (status) {
    case 'submitted':
    case 'reviewed':
      return { bg: 'bg-green-50', border: 'border-green-200', dotClass: 'bg-green-500' };
    case 'draft':
      return { bg: 'bg-amber-50', border: 'border-amber-200', dotClass: 'bg-amber-500' };
    case 'flagged':
      return { bg: 'bg-red-50', border: 'border-red-200', dotClass: 'bg-red-500' };
    default:
      return { bg: 'bg-gray-50', border: 'border-gray-200', dotClass: 'bg-gray-300' };
  }
}

// Financial category badge
function getFinancialBadge(category: string | null): { label: string; className: string } | null {
  if (!category) return null;
  switch (category) {
    case 'cash': return { label: 'Cash', className: 'bg-green-100 text-green-700' };
    case 'insurance': return { label: 'TPA', className: 'bg-blue-100 text-blue-700' };
    case 'credit': return { label: 'Credit', className: 'bg-amber-100 text-amber-700' };
    default: return null;
  }
}

export function PatientsView({ onOpenPatient, onNavigateToChannel }: PatientsViewProps) {
  const [patients, setPatients] = useState<PatientThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');

  // Form status per patient: { patient_id: { form_type: status } }
  const [formStatuses, setFormStatuses] = useState<Record<string, Record<string, string>>>({});

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createTab, setCreateTab] = useState<CreateTab>('single');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fName, setFName] = useState('');
  const [fUhid, setFUhid] = useState('');
  const [fStage, setFStage] = useState<PatientStage>('opd');

  // IP Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [uploadResult, setUploadResult] = useState<{
    created: number; skipped: number; errors: number;
    created_list: string[]; skipped_list: string[]; message: string;
  } | null>(null);

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

  // Fetch form statuses whenever patient list changes
  useEffect(() => {
    if (patients.length === 0) return;
    const ids = patients.map(p => p.id).join(',');
    fetch(`/api/patients/form-status?ids=${ids}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setFormStatuses(data.data || {});
      })
      .catch(() => { /* non-fatal */ });
  }, [patients]);

  const filtered = search
    ? patients.filter(p =>
        p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
        p.uhid?.toLowerCase().includes(search.toLowerCase()) ||
        p.ip_number?.toLowerCase().includes(search.toLowerCase()) ||
        p.bed_number?.toLowerCase().includes(search.toLowerCase())
      )
    : patients;

  // Stage counts for filter pills (computed from FULL patient list, not filtered)
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of patients) {
      counts[p.current_stage] = (counts[p.current_stage] || 0) + 1;
    }
    return counts;
  }, [patients]);

  const handleUpload = async () => {
    if (!uploadFile) { setMsg({ type: 'error', text: 'Please select a CSV file.' }); return; }
    setMsg(null);
    setUploadResult(null);
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('date', uploadDate);
      const res = await fetch('/api/patients/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setUploadResult(data.data);
        setMsg({ type: 'success', text: data.message });
        fetchPatients();
      } else {
        setMsg({ type: 'error', text: data.error || 'Import failed.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error during upload.' });
    } finally {
      setSaving(false);
    }
  };

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
            placeholder="Search by name, UHID, IP#, or bed..."
            className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-even-blue/30"
          />
        </div>

        {/* Stage filter pills with counts */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setStageFilter('')}
            className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
              !stageFilter ? 'bg-even-blue text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            All{patients.length > 0 ? ` (${patients.length})` : ''}
          </button>
          {(Object.entries(PATIENT_STAGE_LABELS) as [PatientStage, string][]).map(([key, label]) => {
            const count = stageCounts[key] || 0;
            return (
              <button
                key={key}
                onClick={() => setStageFilter(key)}
                className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  stageFilter === key
                    ? 'text-white'
                    : count > 0
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-gray-50 text-gray-300'
                }`}
                style={stageFilter === key ? { backgroundColor: PATIENT_STAGE_COLORS[key] } : undefined}
              >
                {label}{count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
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
                ? 'Try a different name, UHID, IP#, or bed number'
                : 'Tap the + button to create a patient thread. Any staff member can start one.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(patient => {
              const stageColor = PATIENT_STAGE_COLORS[patient.current_stage];
              const forms = FORMS_BY_STAGE[patient.current_stage] || [];
              const patientFormStatuses = formStatuses[patient.id] || {};
              const financialBadge = getFinancialBadge(patient.financial_category);

              // Parse bed info from primary_diagnosis if no admission_tracker data
              let bedDisplay = patient.bed_number;
              let floorDisplay: string | null = null;
              if (!bedDisplay && patient.primary_diagnosis) {
                const bedMatch = patient.primary_diagnosis.match(/Bed:\s*([^|]+)/);
                const floorMatch = patient.primary_diagnosis.match(/Floor:\s*([^|]+)/);
                if (bedMatch) bedDisplay = bedMatch[1].trim();
                if (floorMatch) floorDisplay = floorMatch[1].trim();
              }

              return (
                <button
                  key={patient.id}
                  onClick={() => {
                    if (onOpenPatient) {
                      onOpenPatient(patient);
                    } else if (onNavigateToChannel && patient.getstream_channel_id) {
                      onNavigateToChannel(patient.getstream_channel_id);
                    } else if (!patient.getstream_channel_id) {
                      setMsg({ type: 'error', text: `No chat channel for ${patient.patient_name}.` });
                    }
                  }}
                  className="w-full flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow text-left"
                >
                  {/* Stage indicator */}
                  <div
                    className="w-1 self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: stageColor }}
                  />

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + Stage badge */}
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-even-navy truncate">
                        {patient.patient_name}
                      </span>
                      <span
                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: stageColor }}
                      >
                        {PATIENT_STAGE_LABELS[patient.current_stage]}
                      </span>
                    </div>

                    {/* Row 2: UHID, IP#, Bed, Financial */}
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {patient.uhid && <span>{patient.uhid}</span>}
                      {patient.ip_number && (
                        <>
                          <span className="text-gray-200">·</span>
                          <span>IP: {patient.ip_number}</span>
                        </>
                      )}
                      {bedDisplay && (
                        <>
                          <span className="text-gray-200">·</span>
                          <span className="font-medium text-even-navy">
                            Bed {bedDisplay}
                            {floorDisplay ? ` · ${floorDisplay}F` : ''}
                          </span>
                        </>
                      )}
                      {financialBadge && (
                        <span className={`text-[9px] px-1.5 py-0 rounded-full font-semibold ${financialBadge.className}`}>
                          {financialBadge.label}
                        </span>
                      )}
                    </div>

                    {/* Row 3: Doctor + Dept */}
                    {patient.primary_consultant_name && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        {patient.primary_consultant_name}
                        {patient.department_name ? ` · ${patient.department_name}` : ''}
                      </div>
                    )}

                    {/* Row 4: Form chiclets */}
                    {forms.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {forms.map(formType => {
                          const status = patientFormStatuses[formType];
                          const colors = getStatusColor(status);
                          return (
                            <span
                              key={formType}
                              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${colors.bg} ${colors.border}`}
                              title={`${FORM_TYPE_LABELS[formType]}: ${status || 'Not started'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${colors.dotClass}`} />
                              <span className="text-gray-600">{getChicletLabel(formType)}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-0 sm:mx-4 shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <h2 className="text-lg font-semibold text-even-navy">Add Patients</h2>
              <button onClick={() => { setShowCreate(false); setUploadResult(null); setUploadFile(null); }} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            {/* Tab switcher */}
            <div className="flex border-b border-gray-200 shrink-0">
              <button
                onClick={() => { setCreateTab('single'); setMsg(null); setUploadResult(null); }}
                className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
                  createTab === 'single'
                    ? 'text-even-blue border-b-2 border-even-blue'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Single Patient
              </button>
              <button
                onClick={() => { setCreateTab('upload'); setMsg(null); }}
                className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${
                  createTab === 'upload'
                    ? 'text-even-blue border-b-2 border-even-blue'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Upload size={14} />
                IP Upload
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ── Single Patient Tab ── */}
              {createTab === 'single' && (
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
                </div>
              )}

              {/* ── IP Upload Tab ── */}
              {createTab === 'upload' && (
                <div className="px-5 py-4 space-y-4">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-blue-700 leading-relaxed">
                      Upload the <strong>KareXpert IP Patient List CSV</strong> to bulk-import admitted patients.
                      Existing patients (matched by UHID) will be skipped — only new patients are added.
                      Doctors not yet in Rounds will be auto-created as staff profiles.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Import Date</label>
                    <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CSV File *</label>
                    <label className={`flex items-center gap-3 w-full px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                      uploadFile ? 'border-even-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <FileSpreadsheet size={20} className={uploadFile ? 'text-even-blue' : 'text-gray-400'} />
                      <div className="flex-1 min-w-0">
                        {uploadFile ? (
                          <>
                            <p className="text-sm font-medium text-even-navy truncate">{uploadFile.name}</p>
                            <p className="text-xs text-gray-400">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-400">Tap to select CSV file</p>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={e => {
                          setUploadFile(e.target.files?.[0] || null);
                          setUploadResult(null);
                          setMsg(null);
                        }}
                      />
                    </label>
                  </div>

                  {/* Upload results */}
                  {uploadResult && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 bg-green-50 rounded-lg">
                          <div className="text-lg font-bold text-green-700">{uploadResult.created}</div>
                          <div className="text-[10px] text-green-600 font-medium">Created</div>
                        </div>
                        <div className="p-2 bg-yellow-50 rounded-lg">
                          <div className="text-lg font-bold text-yellow-700">{uploadResult.skipped}</div>
                          <div className="text-[10px] text-yellow-600 font-medium">Skipped</div>
                        </div>
                        <div className="p-2 bg-red-50 rounded-lg">
                          <div className="text-lg font-bold text-red-700">{uploadResult.errors}</div>
                          <div className="text-[10px] text-red-600 font-medium">Errors</div>
                        </div>
                      </div>
                      {uploadResult.created_list.length > 0 && (
                        <details className="text-xs">
                          <summary className="text-green-700 font-medium cursor-pointer py-1">
                            {uploadResult.created_list.length} patients created
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-gray-600 pl-3 max-h-24 overflow-y-auto">
                            {uploadResult.created_list.map((p, i) => <li key={i}>• {p}</li>)}
                          </ul>
                        </details>
                      )}
                      {uploadResult.skipped_list.length > 0 && (
                        <details className="text-xs">
                          <summary className="text-yellow-700 font-medium cursor-pointer py-1">
                            {uploadResult.skipped_list.length} already in Rounds (skipped)
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-gray-600 pl-3 max-h-24 overflow-y-auto">
                            {uploadResult.skipped_list.map((p, i) => <li key={i}>• {p}</li>)}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Shared message toast */}
              {msg && showCreate && (
                <div className={`mx-5 mb-3 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
                  msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {msg.text}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 px-5 py-4 border-t border-gray-200 shrink-0">
              <button onClick={() => { setShowCreate(false); setUploadResult(null); setUploadFile(null); }}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
              {createTab === 'single' ? (
                <button onClick={handleCreate} disabled={saving}
                  className="flex-1 px-4 py-2.5 text-sm bg-even-blue text-white rounded-lg disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create'}
                </button>
              ) : (
                <button onClick={handleUpload} disabled={saving || !uploadFile}
                  className="flex-1 px-4 py-2.5 text-sm bg-even-blue text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <Upload size={14} />
                  {saving ? 'Importing...' : 'Import Patients'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
