'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Activity,
  X,
  AlertCircle,
  CheckCircle,
  Upload,
  FileSpreadsheet,
  Trash2,
  RotateCcw,
  Loader2,
  Archive,
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
  bed_number: string | null;
  room_number: string | null;
  room_category: string | null;
  financial_category: string | null;
  // LSQ fields
  lsq_lead_id?: string | null;
  lsq_last_synced_at?: string | null;
  // Archive fields
  archived_at?: string | null;
  archive_type?: string | null;
  archive_reason?: string | null;
  archive_reason_detail?: string | null;
  archived_by_name?: string | null;
}

interface PatientsViewProps {
  onOpenPatient?: (patient: PatientThread) => void;
  onNavigateToChannel?: (channelId: string) => void;
}

// Short labels for chiclets
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

function getFinancialBadge(category: string | null): { label: string; className: string } | null {
  if (!category) return null;
  switch (category) {
    case 'cash': return { label: 'Cash', className: 'bg-green-100 text-green-700' };
    case 'insurance': return { label: 'TPA', className: 'bg-blue-100 text-blue-700' };
    case 'credit': return { label: 'Credit', className: 'bg-amber-100 text-amber-700' };
    default: return null;
  }
}

const REMOVAL_REASONS = [
  { value: 'duplicate_entry', label: 'Duplicate Entry' },
  { value: 'wrong_patient_created', label: 'Wrong Patient Created' },
  { value: 'transfer_to_other_facility', label: 'Transfer to Another Facility' },
  { value: 'lama', label: 'Left Against Medical Advice (LAMA)' },
  { value: 'death', label: 'Death' },
  { value: 'test_demo_patient', label: 'Test/Demo Patient' },
  { value: 'other', label: 'Other' },
];

function formatArchiveDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PatientsView({ onOpenPatient, onNavigateToChannel }: PatientsViewProps) {
  const [patients, setPatients] = useState<PatientThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [formStatuses, setFormStatuses] = useState<Record<string, Record<string, string>>>({});
  const [serverStageCounts, setServerStageCounts] = useState<Record<string, number>>({});

  // Archive state
  const [archivedPostDC, setArchivedPostDC] = useState<PatientThread[]>([]);
  const [archivedRemoved, setArchivedRemoved] = useState<PatientThread[]>([]);
  const [showPostDCAccordion, setShowPostDCAccordion] = useState(false);
  const [showRemovedAccordion, setShowRemovedAccordion] = useState(false);

  // Remove modal
  const [removeTarget, setRemoveTarget] = useState<PatientThread | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeDetail, setRemoveDetail] = useState('');
  const [removeLoading, setRemoveLoading] = useState(false);

  // Restore loading
  const [restoreLoading, setRestoreLoading] = useState<string | null>(null);

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
      // Use a high limit for the "All" tab to avoid truncation
      const limit = stageFilter ? '500' : '1000';
      const params = new URLSearchParams({ limit });
      if (stageFilter) params.set('stage', stageFilter);
      const res = await fetch(`/api/patients?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setPatients(data.data || []);
        if (data.stageCounts) setServerStageCounts(data.stageCounts);
      }
    } catch (err) {
      console.error('Failed to fetch patients:', err);
    } finally {
      setLoading(false);
    }
  }, [stageFilter]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const limit = '200';
      const offset = String(patients.length);
      const params = new URLSearchParams({ limit, offset });
      if (stageFilter) params.set('stage', stageFilter);
      const res = await fetch(`/api/patients?${params.toString()}`);
      const data = await res.json();
      if (data.success && data.data?.length > 0) {
        setPatients(prev => [...prev, ...data.data]);
      }
    } catch (err) {
      console.error('Failed to load more patients:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [stageFilter, patients.length]);

  const fetchArchived = useCallback(async () => {
    try {
      const [pdRes, rmRes] = await Promise.all([
        fetch('/api/patients/archive?type=post_discharge'),
        fetch('/api/patients/archive?type=removed'),
      ]);
      const pdData = await pdRes.json();
      const rmData = await rmRes.json();
      if (pdData.success) setArchivedPostDC(pdData.data || []);
      if (rmData.success) setArchivedRemoved(rmData.data || []);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => { fetchPatients(); fetchArchived(); }, [fetchPatients, fetchArchived]);

  // Fetch form statuses
  useEffect(() => {
    if (patients.length === 0) return;
    const ids = patients.map(p => p.id).join(',');
    fetch(`/api/patients/form-status?ids=${ids}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setFormStatuses(data.data || {});
      })
      .catch(() => {});
  }, [patients]);

  const filtered = search
    ? patients.filter(p =>
        p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
        p.uhid?.toLowerCase().includes(search.toLowerCase()) ||
        p.ip_number?.toLowerCase().includes(search.toLowerCase()) ||
        p.bed_number?.toLowerCase().includes(search.toLowerCase())
      )
    : patients;

  // Use server-provided counts (accurate totals) with client fallback
  const stageCounts = useMemo(() => {
    if (Object.keys(serverStageCounts).length > 0) return serverStageCounts;
    const counts: Record<string, number> = { total: 0 };
    for (const p of patients) {
      counts[p.current_stage] = (counts[p.current_stage] || 0) + 1;
      counts.total++;
    }
    return counts;
  }, [patients, serverStageCounts]);

  // ----- Actions -----

  const handleRemovePatient = async () => {
    if (!removeTarget || !removeReason) return;
    setRemoveLoading(true);
    try {
      const res = await fetch('/api/patients/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_thread_id: removeTarget.id,
          archive_type: 'removed',
          reason: removeReason,
          reason_detail: removeDetail || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRemoveTarget(null);
        setRemoveReason('');
        setRemoveDetail('');
        fetchPatients();
        fetchArchived();
        setMsg({ type: 'success', text: `${removeTarget.patient_name} removed from active list.` });
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to remove patient.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleRestore = async (patientId: string) => {
    setRestoreLoading(patientId);
    try {
      const res = await fetch('/api/patients/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_thread_id: patientId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchPatients();
        fetchArchived();
        setMsg({ type: 'success', text: 'Patient restored to active list.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Failed to restore patient.' });
    } finally {
      setRestoreLoading(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) { setMsg({ type: 'error', text: 'Please select a CSV file.' }); return; }
    setMsg(null); setUploadResult(null); setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('date', uploadDate);
      const res = await fetch('/api/patients/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) { setUploadResult(data.data); setMsg({ type: 'success', text: data.message }); fetchPatients(); }
      else { setMsg({ type: 'error', text: data.error || 'Import failed.' }); }
    } catch { setMsg({ type: 'error', text: 'Network error during upload.' }); }
    finally { setSaving(false); }
  };

  const handleCreate = async () => {
    setMsg(null);
    if (!fName) { setMsg({ type: 'error', text: 'Patient name is required.' }); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_name: fName, uhid: fUhid || null, current_stage: fStage }),
      });
      const data = await res.json();
      if (data.success) { setMsg({ type: 'success', text: 'Patient thread created.' }); setShowCreate(false); setFName(''); setFUhid(''); setFStage('opd'); fetchPatients(); }
      else { setMsg({ type: 'error', text: data.error || 'Failed to create.' }); }
    } catch { setMsg({ type: 'error', text: 'Network error.' }); }
    finally { setSaving(false); }
  };

  // ----- Render helpers -----

  const renderPatientCard = (patient: PatientThread, options?: { greyed?: boolean; showArchiveInfo?: boolean; showRestore?: boolean }) => {
    const stageColor = PATIENT_STAGE_COLORS[patient.current_stage];
    const forms = FORMS_BY_STAGE[patient.current_stage] || [];
    const patientFormStatuses = formStatuses[patient.id] || {};
    const financialBadge = getFinancialBadge(patient.financial_category);
    const isGreyed = options?.greyed;

    let bedDisplay = patient.bed_number;
    let floorDisplay: string | null = null;
    if (!bedDisplay && patient.primary_diagnosis) {
      const bedMatch = patient.primary_diagnosis.match(/Bed:\s*([^|]+)/);
      const floorMatch = patient.primary_diagnosis.match(/Floor:\s*([^|]+)/);
      if (bedMatch) bedDisplay = bedMatch[1].trim();
      if (floorMatch) floorDisplay = floorMatch[1].trim();
    }

    return (
      <div
        key={patient.id}
        className={`w-full flex flex-col p-3 bg-white rounded-xl border transition-shadow ${
          isGreyed ? 'border-gray-200 opacity-60' : 'border-gray-100 hover:shadow-sm'
        }`}
      >
        <div
          className={`flex items-start gap-3 ${!isGreyed ? 'cursor-pointer' : ''}`}
          onClick={() => {
            if (onOpenPatient) { onOpenPatient(patient); }
            else if (onNavigateToChannel && patient.getstream_channel_id) { onNavigateToChannel(patient.getstream_channel_id); }
          }}
        >
          <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: isGreyed ? '#9CA3AF' : stageColor }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-even-navy truncate">{patient.patient_name}</span>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                style={{ backgroundColor: isGreyed ? '#9CA3AF' : stageColor }}>
                {PATIENT_STAGE_LABELS[patient.current_stage]}
              </span>
              {patient.lsq_lead_id && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-600"
                  title={`Imported from LeadSquared${patient.lsq_last_synced_at ? ` · Last synced: ${new Date(patient.lsq_last_synced_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`}>
                  LSQ
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              {patient.uhid && <span>{patient.uhid}</span>}
              {patient.ip_number && (<><span className="text-gray-200">·</span><span>IP: {patient.ip_number}</span></>)}
              {bedDisplay && (<><span className="text-gray-200">·</span><span className="font-medium text-even-navy">Bed {bedDisplay}{floorDisplay ? ` · ${floorDisplay}` : ''}</span></>)}
              {financialBadge && (<span className={`text-[9px] px-1.5 py-0 rounded-full font-semibold ${financialBadge.className}`}>{financialBadge.label}</span>)}
            </div>
            {patient.primary_consultant_name && (
              <div className="text-xs text-gray-400 mt-0.5 truncate">
                {patient.primary_consultant_name}{patient.department_name ? ` · ${patient.department_name}` : ''}
              </div>
            )}
            {!isGreyed && forms.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {forms.map(formType => {
                  const status = patientFormStatuses[formType];
                  const colors = getStatusColor(status);
                  return (
                    <span key={formType} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${colors.bg} ${colors.border}`}
                      title={`${FORM_TYPE_LABELS[formType]}: ${status || 'Not started'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${colors.dotClass}`} />
                      <span className="text-gray-600">{getChicletLabel(formType)}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          {!isGreyed && <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />}
        </div>

        {/* Archive info + actions */}
        {options?.showArchiveInfo && patient.archived_at && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <div className="text-[10px] text-gray-400">
              {patient.archive_type === 'removed' && patient.archive_reason && (
                <span className="text-red-500 font-medium mr-1.5">
                  {REMOVAL_REASONS.find(r => r.value === patient.archive_reason)?.label || patient.archive_reason}
                </span>
              )}
              <span>{formatArchiveDate(patient.archived_at)}</span>
              {patient.archived_by_name && <span> · by {patient.archived_by_name}</span>}
            </div>
            {options?.showRestore && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRestore(patient.id); }}
                disabled={restoreLoading === patient.id}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                {restoreLoading === patient.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                Restore
              </button>
            )}
          </div>
        )}

        {/* Remove button for active patients */}
        {!isGreyed && !options?.showArchiveInfo && (
          <div className="flex justify-end mt-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); setRemoveTarget(patient); }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <Trash2 size={10} /> Remove
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-even-navy">Patients</h1>
          <button onClick={() => { setMsg(null); setShowCreate(true); }}
            className="w-9 h-9 flex items-center justify-center bg-even-blue text-white rounded-full shadow-md hover:bg-even-navy transition-colors"
            title="Create patient thread">
            <Plus size={20} />
          </button>
        </div>
        <div className="relative mb-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, UHID, IP#, or bed..."
            className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-even-blue/30" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          <button onClick={() => setStageFilter('')}
            className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
              !stageFilter ? 'bg-even-blue text-white' : 'bg-gray-100 text-gray-500'
            }`}>
            All{(stageCounts.total || patients.length) > 0 ? ` (${stageCounts.total || patients.length})` : ''}
          </button>
          {(Object.entries(PATIENT_STAGE_LABELS) as [PatientStage, string][]).map(([key, label]) => {
            const count = stageCounts[key] || 0;
            return (
              <button key={key} onClick={() => setStageFilter(key)}
                className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  stageFilter === key ? 'text-white' : count > 0 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-300'
                }`}
                style={stageFilter === key ? { backgroundColor: PATIENT_STAGE_COLORS[key] } : undefined}>
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

      {/* Patient list + archived accordions */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading patients...</div>
        ) : filtered.length === 0 && archivedPostDC.length === 0 && archivedRemoved.length === 0 ? (
          <div className="text-center py-16">
            <Activity size={40} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 font-medium text-sm">
              {search ? 'No patients match your search' : 'No patient threads yet'}
            </p>
            <p className="text-gray-400 text-xs mt-1">
              {search ? 'Try a different name, UHID, IP#, or bed number' : 'Tap the + button to create a patient thread.'}
            </p>
          </div>
        ) : (
          <>
            {/* Active patients */}
            {filtered.length > 0 && (
              <div className="space-y-2">
                {filtered.map(patient => renderPatientCard(patient))}
                {/* Load more button if there are more patients than currently shown */}
                {!search && (() => {
                  const expectedTotal = stageFilter ? (stageCounts[stageFilter] || 0) : (stageCounts.total || 0);
                  if (patients.length < expectedTotal) {
                    return (
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="w-full py-3 text-sm font-medium text-even-blue bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                      >
                        {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                        {loadingMore ? 'Loading...' : `Load more (${patients.length} of ${expectedTotal})`}
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
            {filtered.length === 0 && (search || stageFilter) && (
              <div className="text-center py-8 text-gray-400 text-sm">No patients match your search</div>
            )}

            {/* Post-Discharge Accordion */}
            {archivedPostDC.length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowPostDCAccordion(!showPostDCAccordion)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <Archive size={14} />
                  Post-Discharge ({archivedPostDC.length})
                  <ChevronDown size={14} className={`ml-auto transition-transform ${showPostDCAccordion ? 'rotate-180' : ''}`} />
                </button>
                {showPostDCAccordion && (
                  <div className="space-y-2 mt-2">
                    {archivedPostDC.map(patient => renderPatientCard(patient, { greyed: true, showArchiveInfo: true, showRestore: true }))}
                  </div>
                )}
              </div>
            )}

            {/* Removed Patients Accordion */}
            {archivedRemoved.length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowRemovedAccordion(!showRemovedAccordion)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-red-50 rounded-xl text-sm font-medium text-red-400 hover:bg-red-100 transition-colors"
                >
                  <Trash2 size={14} />
                  Removed Patients ({archivedRemoved.length})
                  <ChevronDown size={14} className={`ml-auto transition-transform ${showRemovedAccordion ? 'rotate-180' : ''}`} />
                </button>
                {showRemovedAccordion && (
                  <div className="space-y-2 mt-2">
                    {archivedRemoved.map(patient => renderPatientCard(patient, { greyed: true, showArchiveInfo: true, showRestore: true }))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== REMOVE PATIENT MODAL ===== */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveDetail(''); }}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-even-navy">Remove Patient</h3>
              <button onClick={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveDetail(''); }} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-1">{removeTarget.patient_name}</p>
            <p className="text-xs text-gray-400 mb-4">
              {removeTarget.uhid || 'No UHID'}{removeTarget.ip_number ? ` · IP: ${removeTarget.ip_number}` : ''}
            </p>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Reason for removal *</label>
              <select
                value={removeReason}
                onChange={e => setRemoveReason(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                <option value="">Select a reason...</option>
                {REMOVAL_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {removeReason === 'other' && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Details</label>
                <textarea
                  value={removeDetail}
                  onChange={e => setRemoveDetail(e.target.value)}
                  placeholder="Please specify the reason..."
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            )}

            <div className="p-3 bg-amber-50 rounded-xl mb-4">
              <p className="text-xs text-amber-700">
                The patient will be moved to the &quot;Removed Patients&quot; section. Their chat channel will be frozen.
                All data is preserved and can be restored later.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveDetail(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100">
                Cancel
              </button>
              <button
                onClick={handleRemovePatient}
                disabled={!removeReason || (removeReason === 'other' && !removeDetail.trim()) || removeLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {removeLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remove Patient
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="flex border-b border-gray-200 shrink-0">
              <button onClick={() => { setCreateTab('single'); setMsg(null); setUploadResult(null); }}
                className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
                  createTab === 'single' ? 'text-even-blue border-b-2 border-even-blue' : 'text-gray-400 hover:text-gray-600'
                }`}>Single Patient</button>
              <button onClick={() => { setCreateTab('upload'); setMsg(null); }}
                className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${
                  createTab === 'upload' ? 'text-even-blue border-b-2 border-even-blue' : 'text-gray-400 hover:text-gray-600'
                }`}><Upload size={14} />IP Upload</button>
            </div>
            <div className="flex-1 overflow-y-auto">
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
              {createTab === 'upload' && (
                <div className="px-5 py-4 space-y-4">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-blue-700 leading-relaxed">
                      Upload the <strong>KareXpert IP Patient List CSV</strong> to bulk-import admitted patients.
                      Existing patients (matched by UHID) will be skipped.
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
                        {uploadFile ? (<><p className="text-sm font-medium text-even-navy truncate">{uploadFile.name}</p><p className="text-xs text-gray-400">{(uploadFile.size / 1024).toFixed(1)} KB</p></>) : (<p className="text-sm text-gray-400">Tap to select CSV file</p>)}
                      </div>
                      <input type="file" accept=".csv,text/csv" className="hidden"
                        onChange={e => { setUploadFile(e.target.files?.[0] || null); setUploadResult(null); setMsg(null); }} />
                    </label>
                  </div>
                  {uploadResult && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 bg-green-50 rounded-lg"><div className="text-lg font-bold text-green-700">{uploadResult.created}</div><div className="text-[10px] text-green-600 font-medium">Created</div></div>
                        <div className="p-2 bg-yellow-50 rounded-lg"><div className="text-lg font-bold text-yellow-700">{uploadResult.skipped}</div><div className="text-[10px] text-yellow-600 font-medium">Skipped</div></div>
                        <div className="p-2 bg-red-50 rounded-lg"><div className="text-lg font-bold text-red-700">{uploadResult.errors}</div><div className="text-[10px] text-red-600 font-medium">Errors</div></div>
                      </div>
                      {uploadResult.created_list.length > 0 && (<details className="text-xs"><summary className="text-green-700 font-medium cursor-pointer py-1">{uploadResult.created_list.length} patients created</summary><ul className="mt-1 space-y-0.5 text-gray-600 pl-3 max-h-24 overflow-y-auto">{uploadResult.created_list.map((p, i) => <li key={i}>• {p}</li>)}</ul></details>)}
                      {uploadResult.skipped_list.length > 0 && (<details className="text-xs"><summary className="text-yellow-700 font-medium cursor-pointer py-1">{uploadResult.skipped_list.length} already in Rounds (skipped)</summary><ul className="mt-1 space-y-0.5 text-gray-600 pl-3 max-h-24 overflow-y-auto">{uploadResult.skipped_list.map((p, i) => <li key={i}>• {p}</li>)}</ul></details>)}
                    </div>
                  )}
                </div>
              )}
              {msg && showCreate && (
                <div className={`mx-5 mb-3 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
                  msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {msg.text}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-200 shrink-0">
              <button onClick={() => { setShowCreate(false); setUploadResult(null); setUploadFile(null); }}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
              {createTab === 'single' ? (
                <button onClick={handleCreate} disabled={saving}
                  className="flex-1 px-4 py-2.5 text-sm bg-even-blue text-white rounded-lg disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create'}</button>
              ) : (
                <button onClick={handleUpload} disabled={saving || !uploadFile}
                  className="flex-1 px-4 py-2.5 text-sm bg-even-blue text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <Upload size={14} />{saving ? 'Importing...' : 'Import Patients'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
