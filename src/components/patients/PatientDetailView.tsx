'use client';

// ============================================
// PatientDetailView — full patient detail panel.
// Shows: stage progress bar, inline-editable
// patient info (consultant, dept, bed), PAC
// status dropdown, advance stage, form history.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  MessageSquare,
  FileText,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  Building2,
  Hash,
  Calendar,
  BedDouble,
  CreditCard,
  Pencil,
  Check,
  X,
  Stethoscope,
  Paperclip,
} from 'lucide-react';
import type { PatientStage, FormType, FormStatus, PacStatus } from '@/types';
import {
  PATIENT_STAGE_LABELS,
  PATIENT_STAGE_COLORS,
  PAC_STATUS_LABELS,
  PAC_STATUS_COLORS,
  PAC_RELEVANT_STAGES,
} from '@/types';
import { FORM_TYPE_LABELS, FORMS_BY_STAGE } from '@/lib/form-registry';
import { PredictionCard } from '@/components/ai/PredictionCard';
import { SurgeryPanel } from '@/components/ot/SurgeryPanel';
import { PatientFilesTab } from './PatientFilesTab';

type DetailTab = 'overview' | 'files';

// ── Ordered stages for the progress bar ──
const STAGES_ORDERED: PatientStage[] = [
  'opd',
  'pre_admission',
  'admitted',
  'pre_op',
  'surgery',
  'post_op',
  'discharge',
  'post_discharge',
];

// New stages shown separately (not on the linear progress bar)
const BRANCH_STAGES: PatientStage[] = [
  'medical_management',
  'post_op_care',
  'long_term_followup',
];

// Valid stage transitions (mirror of backend)
const VALID_TRANSITIONS: Record<string, string[]> = {
  opd: ['pre_admission', 'admitted'],
  pre_admission: ['admitted', 'opd'],
  admitted: ['pre_op', 'medical_management', 'discharge'],
  medical_management: ['discharge', 'admitted'],
  pre_op: ['surgery', 'admitted'],
  surgery: ['post_op'],
  post_op: ['discharge', 'surgery'],
  discharge: ['post_discharge', 'post_op_care', 'long_term_followup', 'admitted'],
  post_discharge: [],
  post_op_care: ['discharge'],
  long_term_followup: ['discharge'],
};

// ── Interfaces ──
interface FormEntry {
  id: string;
  form_type: FormType;
  status: FormStatus;
  completion_score: number | null;
  submitted_by_name?: string;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

interface ConsultantOption {
  id: string;
  full_name: string;
}

interface PatientDetail {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: PatientStage;
  primary_consultant_id: string | null;
  primary_consultant_name: string | null;
  department_id: string | null;
  department_name: string | null;
  getstream_channel_id: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  created_at: string;
  forms: FormEntry[];
  bed_number: string | null;
  room_number: string | null;
  room_category: string | null;
  financial_category: string | null;
  primary_diagnosis: string | null;
  pac_status: PacStatus | null;
}

interface PatientDetailViewProps {
  patientId: string;
  onBack: () => void;
  onOpenChannel?: (channelId: string) => void;
  userRole?: string;
  userId?: string;
}

// ── Status badge colors ──
const STATUS_COLORS: Record<FormStatus, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-700' },
  reviewed: { bg: 'bg-green-50', text: 'text-green-700' },
  flagged: { bg: 'bg-red-50', text: 'text-red-700' },
};

function getFinancialBadge(category: string | null): { label: string; className: string } | null {
  if (!category) return null;
  switch (category) {
    case 'cash': return { label: 'Cash', className: 'bg-green-100 text-green-700' };
    case 'insurance': return { label: 'TPA', className: 'bg-blue-100 text-blue-700' };
    case 'credit': return { label: 'Credit', className: 'bg-amber-100 text-amber-700' };
    default: return null;
  }
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.max(1, Math.ceil((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

export function PatientDetailView({
  patientId,
  onBack,
  onOpenChannel,
  userRole = '',
  userId = '',
}: PatientDetailViewProps) {
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmStage, setConfirmStage] = useState<PatientStage | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  // Discharge milestone state
  const [dischargeMilestone, setDischargeMilestone] = useState<Record<string, unknown> | null>(null);
  const [dischargeProgress, setDischargeProgress] = useState<{
    completed: string[];
    current: string | null;
    pending: string[];
    totalElapsedMinutes: number | null;
  } | null>(null);

  // Insurance claim state
  const [insuranceClaim, setInsuranceClaim] = useState<Record<string, unknown> | null>(null);
  const [claimSummary, setClaimSummary] = useState<{
    statusLabel: string;
    statusColor: string;
    headroom: number | null;
    enhancementSoonWarning: boolean;
    proportionalDeductionRisk: boolean;
    recoveryPct: number | null;
    runningBill: number | null;
  } | null>(null);
  const [claimTimeline, setClaimTimeline] = useState<Record<string, unknown>[]>([]);

  // Inline edit state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Dropdown data for inline edit
  const [departments, setDepartments] = useState<Department[]>([]);
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);

  const fetchPatient = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}`);
      const data = await res.json();
      if (data.success) setPatient(data.data);
    } catch (err) {
      console.error('Failed to fetch patient detail:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const fetchDischargeStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/discharge`);
      const data = await res.json();
      if (data.success && data.data) {
        setDischargeMilestone(data.data.milestone);
        setDischargeProgress(data.data.progress);
      } else {
        setDischargeMilestone(null);
        setDischargeProgress(null);
      }
    } catch {
      // Non-fatal
    }
  }, [patientId]);

  const fetchClaimStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/claim`);
      const data = await res.json();
      if (data.success && data.data) {
        setInsuranceClaim(data.data.claim);
        setClaimSummary(data.data.summary);
        setClaimTimeline(data.data.timeline || []);
      } else {
        setInsuranceClaim(null);
        setClaimSummary(null);
        setClaimTimeline([]);
      }
    } catch {
      // Non-fatal
    }
  }, [patientId]);

  useEffect(() => { fetchPatient(); }, [fetchPatient]);
  useEffect(() => { fetchDischargeStatus(); }, [fetchDischargeStatus]);
  useEffect(() => { fetchClaimStatus(); }, [fetchClaimStatus]);

  // Fetch departments and consultants for inline edit
  useEffect(() => {
    fetch('/api/departments').then(r => r.json()).then(d => {
      if (d.success) setDepartments(d.data || []);
    }).catch(() => {});
    fetch('/api/profiles?role=department_head&limit=100').then(r => r.json()).then(d => {
      if (d.success) setConsultants(d.data || []);
    }).catch(() => {});
    // Also fetch all doctors/consultants
    fetch('/api/profiles?limit=200').then(r => r.json()).then(d => {
      if (d.success) {
        setConsultants(d.data?.map((p: { id: string; full_name: string }) => ({
          id: p.id,
          full_name: p.full_name,
        })) || []);
      }
    }).catch(() => {});
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  // ── Inline edit handlers ──
  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || '');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (field: string) => {
    if (!patient) return;
    setEditSaving(true);
    try {
      const body: Record<string, string> = {};
      if (field === 'consultant') body.primary_consultant_id = editValue;
      else if (field === 'department') body.department_id = editValue;
      else if (field === 'bed') body.bed_number = editValue;

      const res = await fetch(`/api/patients/${patient.id}/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Updated');
        fetchPatient();
      } else {
        showToast('error', data.error || 'Failed to update');
      }
    } catch {
      showToast('error', 'Network error');
    } finally {
      setEditSaving(false);
      setEditingField(null);
    }
  };

  // ── PAC Status handler ──
  const handlePacChange = async (newStatus: string) => {
    if (!patient) return;
    try {
      const res = await fetch(`/api/patients/${patient.id}/pac-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pac_status: newStatus || null }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'PAC status updated');
        fetchPatient();
      } else {
        showToast('error', data.error || 'Failed to update PAC status');
      }
    } catch {
      showToast('error', 'Network error');
    }
  };

  const handleAdvanceStage = async (newStage: PatientStage) => {
    if (!patient) return;
    setAdvancing(true);
    setMsg(null);
    setConfirmStage(null);
    try {
      const res = await fetch(`/api/patients/${patient.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', `Stage advanced to ${PATIENT_STAGE_LABELS[newStage]}`);
        fetchPatient();
      } else {
        showToast('error', data.error || 'Failed to advance stage');
      }
    } catch {
      showToast('error', 'Network error');
    } finally {
      setAdvancing(false);
    }
  };

  // ── Loading / Not found ──
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-even-white">
        <div className="px-4 pt-4 pb-2 flex items-center gap-3 border-b border-gray-100">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} className="text-even-navy" />
          </button>
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-even-blue/20 border-t-even-blue rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex flex-col h-full bg-even-white">
        <div className="px-4 pt-4 pb-2 flex items-center gap-3 border-b border-gray-100">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} className="text-even-navy" />
          </button>
          <span className="text-sm text-gray-500">Patient not found</span>
        </div>
      </div>
    );
  }

  const currentStageIdx = STAGES_ORDERED.indexOf(patient.current_stage);
  const isBranchStage = BRANCH_STAGES.includes(patient.current_stage);
  const nextStages = VALID_TRANSITIONS[patient.current_stage] || [];

  // Forward = higher index on main track or branch stages
  const forwardStages = nextStages.filter(s => {
    const idx = STAGES_ORDERED.indexOf(s as PatientStage);
    return idx > currentStageIdx || BRANCH_STAGES.includes(s as PatientStage);
  });
  const backwardStages = nextStages.filter(s => {
    const idx = STAGES_ORDERED.indexOf(s as PatientStage);
    return idx <= currentStageIdx && !BRANCH_STAGES.includes(s as PatientStage);
  });

  const stageForms = [
    ...(FORMS_BY_STAGE[patient.current_stage] || []),
    ...(FORMS_BY_STAGE['any'] || []),
  ];
  const completedFormTypes = new Set((patient.forms || []).map(f => f.form_type));

  let bedDisplay = patient.bed_number;
  let floorDisplay: string | null = null;
  if (!bedDisplay && patient.primary_diagnosis) {
    const bedMatch = patient.primary_diagnosis.match(/Bed:\s*([^|]+)/);
    const floorMatch = patient.primary_diagnosis.match(/Floor:\s*([^|]+)/);
    if (bedMatch) bedDisplay = bedMatch[1].trim();
    if (floorMatch) floorDisplay = floorMatch[1].trim();
  }
  const financialBadge = getFinancialBadge(patient.financial_category);

  // Should show PAC status?
  const showPac = PAC_RELEVANT_STAGES.includes(patient.current_stage);

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} className="text-even-navy" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-even-navy truncate">{patient.patient_name}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {patient.uhid && <span className="flex items-center gap-1"><Hash size={10} />{patient.uhid}</span>}
              {patient.ip_number && <span>IP: {patient.ip_number}</span>}
            </div>
          </div>
          {patient.getstream_channel_id && onOpenChannel && (
            <button
              onClick={() => onOpenChannel(patient.getstream_channel_id!)}
              className="flex items-center gap-1.5 px-3 py-2 bg-even-blue text-white rounded-lg text-xs font-medium"
            >
              <MessageSquare size={14} /> Chat
            </button>
          )}
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex border-b border-gray-100 px-4">
        {([
          { id: 'overview' as DetailTab, label: 'Overview', icon: <FileText size={14} /> },
          { id: 'files' as DetailTab, label: 'Files', icon: <Paperclip size={14} /> },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-even-blue text-even-blue'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Files Tab ── */}
      {activeTab === 'files' && (
        <div className="flex-1 overflow-hidden">
          <PatientFilesTab patientId={patient.id} patientName={patient.patient_name} />
        </div>
      )}

      {/* ── Overview Tab (Scrollable content) ── */}
      <div className={`flex-1 overflow-y-auto pb-4 ${activeTab !== 'overview' ? 'hidden' : ''}`}>
        {/* ── Stage Progress Bar ── */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-0.5">
            {STAGES_ORDERED.map((stage, idx) => {
              const isCompleted = idx < currentStageIdx && !isBranchStage;
              const isCurrent = stage === patient.current_stage;
              const color = PATIENT_STAGE_COLORS[stage];
              return (
                <div key={stage} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full h-2 rounded-full"
                    style={{
                      backgroundColor: isCompleted || isCurrent ? color : '#E5E7EB',
                      opacity: isCompleted ? 0.5 : 1,
                    }}
                  />
                  {(isCurrent || idx === currentStageIdx - 1 || idx === currentStageIdx + 1) && (
                    <span
                      className={`text-[9px] mt-1 text-center leading-tight ${isCurrent ? 'font-bold' : 'text-gray-400'}`}
                      style={isCurrent ? { color } : undefined}
                    >
                      {PATIENT_STAGE_LABELS[stage]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center mt-3">
            <span
              className="text-xs font-semibold px-3 py-1 rounded-full text-white"
              style={{ backgroundColor: PATIENT_STAGE_COLORS[patient.current_stage] }}
            >
              {PATIENT_STAGE_LABELS[patient.current_stage]}
            </span>
          </div>
        </div>

        {/* ── Patient Info Card (inline editable) ── */}
        <div className="mx-4 bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="space-y-2.5">
            {/* Consultant — inline editable */}
            <div className="flex items-center gap-2.5 text-sm">
              <User size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-500 shrink-0">Consultant:</span>
              {editingField === 'consultant' ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <select
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                    autoFocus
                  >
                    <option value="">— None —</option>
                    {consultants.map(c => (
                      <option key={c.id} value={c.id}>{c.full_name}</option>
                    ))}
                  </select>
                  <button onClick={() => saveEdit('consultant')} disabled={editSaving} className="p-1 text-green-600 hover:bg-green-50 rounded">
                    <Check size={14} />
                  </button>
                  <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-50 rounded">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-even-navy font-medium truncate">
                    {patient.primary_consultant_name || 'Not assigned'}
                  </span>
                  <button
                    onClick={() => startEdit('consultant', patient.primary_consultant_id || '')}
                    className="p-1 text-gray-300 hover:text-even-blue hover:bg-blue-50 rounded shrink-0"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Department — inline editable */}
            <div className="flex items-center gap-2.5 text-sm">
              <Building2 size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-500 shrink-0">Department:</span>
              {editingField === 'department' ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <select
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                    autoFocus
                  >
                    <option value="">— None —</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <button onClick={() => saveEdit('department')} disabled={editSaving} className="p-1 text-green-600 hover:bg-green-50 rounded">
                    <Check size={14} />
                  </button>
                  <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-50 rounded">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-even-navy font-medium truncate">
                    {patient.department_name || 'Not assigned'}
                  </span>
                  <button
                    onClick={() => startEdit('department', patient.department_id || '')}
                    className="p-1 text-gray-300 hover:text-even-blue hover:bg-blue-50 rounded shrink-0"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Bed — inline editable */}
            <div className="flex items-center gap-2.5 text-sm">
              <BedDouble size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-500 shrink-0">Bed:</span>
              {editingField === 'bed' ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none"
                    placeholder="e.g. 106 · First Floor"
                    autoFocus
                  />
                  <button onClick={() => saveEdit('bed')} disabled={editSaving} className="p-1 text-green-600 hover:bg-green-50 rounded">
                    <Check size={14} />
                  </button>
                  <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-50 rounded">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-even-navy font-medium truncate">
                    {bedDisplay || 'Not assigned'}
                    {floorDisplay ? ` · ${floorDisplay}` : ''}
                    {patient.room_category && patient.room_category !== 'general' ? (
                      <span className="text-gray-400 font-normal"> ({patient.room_category})</span>
                    ) : null}
                  </span>
                  <button
                    onClick={() => startEdit('bed', patient.bed_number || '')}
                    className="p-1 text-gray-300 hover:text-even-blue hover:bg-blue-50 rounded shrink-0"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Financial Category (read-only) */}
            {financialBadge && (
              <div className="flex items-center gap-2.5 text-sm">
                <CreditCard size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Payment:</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${financialBadge.className}`}>
                  {financialBadge.label}
                </span>
              </div>
            )}

            {/* Admission date */}
            {patient.admission_date && (
              <div className="flex items-center gap-2.5 text-sm">
                <Calendar size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Admitted:</span>
                <span className="text-even-navy font-medium">
                  {new Date(patient.admission_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {!patient.discharge_date && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-semibold">
                      Day {daysSince(patient.admission_date)}
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* Discharge date */}
            {patient.discharge_date && (
              <div className="flex items-center gap-2.5 text-sm">
                <Calendar size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Discharged:</span>
                <span className="text-even-navy font-medium">
                  {new Date(patient.discharge_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            )}

            {/* Created */}
            <div className="flex items-center gap-2.5 text-sm">
              <Clock size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-500">Created:</span>
              <span className="text-even-navy font-medium">
                {new Date(patient.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>

        {/* ── PAC Status (Pre-Op and above) ── */}
        {showPac && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              PAC Status
            </h3>
            <div className="bg-white rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2.5">
                <Stethoscope size={14} className="text-gray-400 shrink-0" />
                <select
                  value={patient.pac_status || ''}
                  onChange={e => handlePacChange(e.target.value)}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                >
                  <option value="">— Not Set —</option>
                  {Object.entries(PAC_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {patient.pac_status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${PAC_STATUS_COLORS[patient.pac_status]?.bg || ''} ${PAC_STATUS_COLORS[patient.pac_status]?.text || ''}`}>
                    {PAC_STATUS_LABELS[patient.pac_status] || patient.pac_status}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Toast ── */}
        {msg && (
          <div className={`mx-4 mb-4 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
            msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {msg.text}
          </div>
        )}

        {/* ── Discharge Progress ── */}
        {dischargeProgress && dischargeMilestone && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Discharge Progress
              {dischargeProgress.totalElapsedMinutes != null && (
                <span className="ml-2 text-even-blue font-bold normal-case">
                  {dischargeProgress.totalElapsedMinutes < 60
                    ? `${dischargeProgress.totalElapsedMinutes}m`
                    : `${Math.floor(dischargeProgress.totalElapsedMinutes / 60)}h ${dischargeProgress.totalElapsedMinutes % 60}m`
                  }
                </span>
              )}
            </h3>
            <div className="bg-white rounded-xl border border-gray-100 p-3">
              {/* Progress dots */}
              <div className="flex items-center gap-1 mb-3 overflow-x-auto">
                {['discharge_ordered', 'pharmacy_clearance', 'lab_clearance', 'discharge_summary', 'billing_closure', 'final_bill_submitted', 'final_approval', 'patient_settled', 'patient_departed'].map((step, idx, arr) => {
                  const isCompleted = dischargeProgress.completed.includes(step);
                  const isCurrent = dischargeProgress.current === step;
                  return (
                    <div key={step} className="flex items-center">
                      <div
                        className={`w-3 h-3 rounded-full flex-shrink-0 ${
                          isCompleted ? 'bg-green-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-gray-200'
                        }`}
                        title={
                          ({'discharge_ordered': 'Order', 'pharmacy_clearance': 'Pharmacy', 'lab_clearance': 'Labs',
                            'discharge_summary': 'Summary', 'billing_closure': 'Billing', 'final_bill_submitted': 'Submit',
                            'final_approval': 'Approval', 'patient_settled': 'Settled', 'patient_departed': 'Departed'
                          } as Record<string, string>)[step] || step
                        }
                      />
                      {idx < arr.length - 1 && (
                        <div className={`w-3 h-0.5 ${isCompleted ? 'bg-green-300' : 'bg-gray-200'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Step list */}
              <div className="space-y-1.5">
                {dischargeProgress.completed.map(step => {
                  const stepLabels: Record<string, string> = {
                    discharge_ordered: '🏁 Ordered', pharmacy_clearance: '💊 Pharmacy',
                    lab_clearance: '🔬 Labs', discharge_summary: '📝 Summary',
                    billing_closure: '💰 Billing', final_bill_submitted: '📤 Submitted',
                    final_approval: '✅ Approved', patient_settled: '🧾 Settled',
                    patient_departed: '🚪 Departed',
                  };
                  const timeKey = step + '_at';
                  const atVal = (dischargeMilestone as Record<string, unknown>)[
                    step === 'discharge_ordered' ? 'discharge_ordered_at' :
                    step === 'pharmacy_clearance' ? 'pharmacy_clearance_at' :
                    step === 'lab_clearance' ? 'lab_clearance_at' :
                    step === 'discharge_summary' ? 'discharge_summary_at' :
                    step === 'billing_closure' ? 'billing_closure_at' :
                    step === 'final_bill_submitted' ? 'final_bill_submitted_at' :
                    step === 'final_approval' ? 'final_approval_at' :
                    step === 'patient_settled' ? 'patient_settled_at' :
                    'patient_departed_at'
                  ] as string | null;
                  const timeStr = atVal ? new Date(atVal).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div key={step} className="flex items-center gap-2 text-xs">
                      <span className="text-green-600 font-medium">{stepLabels[step] || step}</span>
                      <span className="text-gray-400 ml-auto">{timeStr}</span>
                    </div>
                  );
                })}
                {dischargeProgress.current && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-amber-600 font-medium animate-pulse">
                      {({'discharge_ordered': '🏁 Order', 'pharmacy_clearance': '💊 Pharmacy',
                        'lab_clearance': '🔬 Labs', 'discharge_summary': '📝 Summary',
                        'billing_closure': '💰 Billing', 'final_bill_submitted': '📤 Submit',
                        'final_approval': '✅ Approval', 'patient_settled': '🧾 Settlement',
                        'patient_departed': '🚪 Departure',
                      } as Record<string, string>)[dischargeProgress.current] || dischargeProgress.current}
                    </span>
                    <span className="text-amber-400 ml-auto">pending...</span>
                  </div>
                )}
              </div>
              {/* Bottleneck indicator */}
              {(dischargeMilestone as Record<string, unknown>).bottleneck_step && (
                <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-red-500">
                  Bottleneck: {
                    ({'pharmacy_clearance': 'Pharmacy', 'discharge_summary': 'Discharge Summary',
                      'billing_closure': 'Billing', 'final_bill_submitted': 'Submission',
                      'final_approval': 'Insurer Approval',
                    } as Record<string, string>)[(dischargeMilestone as Record<string, unknown>).bottleneck_step as string] || (dischargeMilestone as Record<string, unknown>).bottleneck_step
                  } ({(dischargeMilestone as Record<string, unknown>).bottleneck_minutes}m)
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Insurance Claim ── */}
        {insuranceClaim && claimSummary && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Insurance Claim
              <span
                className="ml-2 text-xs font-bold normal-case px-1.5 py-0.5 rounded-full"
                style={{
                  color: claimSummary.statusColor,
                  backgroundColor: `${claimSummary.statusColor}15`,
                }}
              >
                {claimSummary.statusLabel}
              </span>
            </h3>
            <div className="bg-white rounded-xl border border-gray-100 p-3">
              {/* Insurer info line */}
              <div className="text-xs text-gray-600 mb-2">
                {(insuranceClaim as Record<string, unknown>).insurer_name && (
                  <span className="font-medium">
                    {(insuranceClaim as Record<string, unknown>).insurer_name as string}
                  </span>
                )}
                {(insuranceClaim as Record<string, unknown>).tpa_name && (
                  <span> via {(insuranceClaim as Record<string, unknown>).tpa_name as string}</span>
                )}
                {(insuranceClaim as Record<string, unknown>).claim_number && (
                  <span className="ml-2 text-gray-400">
                    #{(insuranceClaim as Record<string, unknown>).claim_number as string}
                  </span>
                )}
              </div>

              {/* Financial summary grid */}
              <div className="space-y-1.5 text-xs">
                {(insuranceClaim as Record<string, unknown>).estimated_cost != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Estimated</span>
                    <span className="font-medium">₹{Number((insuranceClaim as Record<string, unknown>).estimated_cost).toLocaleString('en-IN')}</span>
                  </div>
                )}
                {(insuranceClaim as Record<string, unknown>).cumulative_approved_amount != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Approved</span>
                    <span className="font-medium text-green-600">
                      ₹{Number((insuranceClaim as Record<string, unknown>).cumulative_approved_amount).toLocaleString('en-IN')}
                      {(insuranceClaim as Record<string, unknown>).estimated_cost ? (
                        <span className="text-gray-400 ml-1">
                          ({Math.round(
                            (Number((insuranceClaim as Record<string, unknown>).cumulative_approved_amount) /
                            Number((insuranceClaim as Record<string, unknown>).estimated_cost)) * 100
                          )}%)
                        </span>
                      ) : null}
                    </span>
                  </div>
                )}
                {claimSummary.runningBill != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Running Bill</span>
                    <span className="font-medium">₹{claimSummary.runningBill.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {claimSummary.headroom != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Headroom</span>
                    <span className={`font-medium ${claimSummary.headroom < 0 ? 'text-red-600' : claimSummary.enhancementSoonWarning ? 'text-amber-600' : 'text-green-600'}`}>
                      ₹{Math.abs(claimSummary.headroom).toLocaleString('en-IN')}
                      {claimSummary.enhancementSoonWarning && ' ⚠️ Enhancement soon'}
                      {claimSummary.headroom < 0 && ' ⚠️ Over approved'}
                    </span>
                  </div>
                )}
                {(insuranceClaim as Record<string, unknown>).final_bill_amount != null && (
                  <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5">
                    <span className="text-gray-500">Final Bill</span>
                    <span className="font-medium">₹{Number((insuranceClaim as Record<string, unknown>).final_bill_amount).toLocaleString('en-IN')}</span>
                  </div>
                )}
                {(insuranceClaim as Record<string, unknown>).final_approved_amount != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Settled</span>
                    <span className="font-medium text-green-600">
                      ₹{Number((insuranceClaim as Record<string, unknown>).final_approved_amount).toLocaleString('en-IN')}
                      {claimSummary.recoveryPct != null && (
                        <span className="text-gray-400 ml-1">({claimSummary.recoveryPct}% recovery)</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Risk indicators */}
              {(claimSummary.proportionalDeductionRisk || (insuranceClaim as Record<string, unknown>).co_pay_pct) && (
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                  {claimSummary.proportionalDeductionRisk && (insuranceClaim as Record<string, unknown>).proportional_deduction_pct != null && (
                    <div className="text-[10px] text-red-500">
                      ⚠️ Room risk: {Number((insuranceClaim as Record<string, unknown>).proportional_deduction_pct)}% proportional deduction
                    </div>
                  )}
                  {(insuranceClaim as Record<string, unknown>).co_pay_pct != null && Number((insuranceClaim as Record<string, unknown>).co_pay_pct) > 0 && (
                    <div className="text-[10px] text-gray-500">
                      Co-pay: {Number((insuranceClaim as Record<string, unknown>).co_pay_pct)}%
                    </div>
                  )}
                </div>
              )}

              {/* TAT info */}
              {(insuranceClaim as Record<string, unknown>).pre_auth_tat_minutes != null && (
                <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500">
                  Pre-auth TAT: {Math.floor(Number((insuranceClaim as Record<string, unknown>).pre_auth_tat_minutes) / 60)}h {Number((insuranceClaim as Record<string, unknown>).pre_auth_tat_minutes) % 60}m
                  {(insuranceClaim as Record<string, unknown>).final_settlement_tat_minutes != null && (
                    <span className="ml-3">
                      Settlement TAT: {Math.floor(Number((insuranceClaim as Record<string, unknown>).final_settlement_tat_minutes) / 60)}h {Number((insuranceClaim as Record<string, unknown>).final_settlement_tat_minutes) % 60}m
                    </span>
                  )}
                </div>
              )}

              {/* Recent timeline */}
              {claimTimeline.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Recent Events</p>
                  <div className="space-y-1">
                    {claimTimeline.slice(-4).reverse().map((evt) => {
                      const evtTime = evt.created_at
                        ? new Date(evt.created_at as string).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                          })
                        : '';
                      return (
                        <div key={evt.id as string} className="flex items-start gap-1.5 text-[11px]">
                          <span className="text-gray-400 shrink-0 w-[85px]">{evtTime}</span>
                          <span className="text-gray-700 truncate">
                            {evt.performed_by_name as string || 'System'}: {evt.description as string}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Surgery Panel (OT Readiness) ── */}
        {patient && userRole && userId && (
          <SurgeryPanel
            patientThreadId={patient.id}
            userRole={userRole}
            userId={userId}
          />
        )}

        {/* ── Advance Stage ── */}
        {nextStages.length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Advance Stage
            </h3>
            <div className="flex flex-col gap-2">
              {forwardStages.map(stage => (
                <button
                  key={stage}
                  onClick={() => setConfirmStage(stage as PatientStage)}
                  disabled={advancing}
                  className="w-full flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100 hover:border-even-blue/30 hover:shadow-sm transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PATIENT_STAGE_COLORS[stage as PatientStage] }} />
                    <span className="text-sm font-medium text-even-navy">
                      Advance to {PATIENT_STAGE_LABELS[stage as PatientStage]}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ))}
              {backwardStages.length > 0 && (
                <div className="border-t border-gray-100 pt-2 mt-1">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5 px-1">Corrections</p>
                  {backwardStages.map(stage => (
                    <button
                      key={stage}
                      onClick={() => setConfirmStage(stage as PatientStage)}
                      disabled={advancing}
                      className="w-full flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-left hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PATIENT_STAGE_COLORS[stage as PatientStage] }} />
                        <span className="text-xs text-gray-600">Move back to {PATIENT_STAGE_LABELS[stage as PatientStage]}</span>
                      </div>
                      <ChevronRight size={14} className="text-gray-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Stage-Relevant Forms ── */}
        <div className="mx-4 mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Forms for this Stage</h3>
          {stageForms.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No forms for this stage.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stageForms.map(formType => {
                const done = completedFormTypes.has(formType);
                return (
                  <a key={formType} href={`/forms/new?type=${formType}&patient=${patient.id}`}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow">
                    <FileText size={16} className={done ? 'text-green-500' : 'text-gray-300'} />
                    <div className="flex-1 min-w-0"><span className="text-sm text-even-navy">{FORM_TYPE_LABELS[formType]}</span></div>
                    {done ? <CheckCircle size={14} className="text-green-500 shrink-0" /> : (
                      <span className="text-[11px] font-medium text-white bg-even-blue px-2.5 py-1 rounded-full shrink-0">Fill</span>
                    )}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Form History ── */}
        {patient.forms && patient.forms.length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Form History ({patient.forms.length})</h3>
            <div className="flex flex-col gap-1.5">
              {patient.forms.map(form => {
                const statusStyle = STATUS_COLORS[form.status] || STATUS_COLORS.draft;
                const score = form.completion_score != null ? Math.round(form.completion_score * 100) : null;
                return (
                  <a key={form.id} href={`/forms/${form.id}`}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow">
                    <FileText size={16} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-even-navy truncate">{FORM_TYPE_LABELS[form.form_type] || form.form_type}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusStyle.bg} ${statusStyle.text}`}>{form.status}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        {form.submitted_by_name && <span>{form.submitted_by_name}</span>}
                        <span>{new Date(form.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                        {score !== null && (
                          <span className={score >= 80 ? 'text-green-600' : score >= 50 ? 'text-orange-500' : 'text-red-500'}>{score}%</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AI Predictions ── */}
        <div className="mx-4 mb-4">
          <PredictionCard patientThreadId={patient.id} />
        </div>
      </div>

      {/* ── Stage Advance Confirmation Modal ── */}
      {confirmStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-[90%] max-w-sm mx-4 shadow-xl overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-base font-semibold text-even-navy mb-1">
                {(STAGES_ORDERED.indexOf(confirmStage) > currentStageIdx) || BRANCH_STAGES.includes(confirmStage)
                  ? 'Advance Stage' : 'Move Stage Back'}
              </h3>
              <p className="text-sm text-gray-500">
                Move <strong>{patient.patient_name}</strong> from{' '}
                <strong>{PATIENT_STAGE_LABELS[patient.current_stage]}</strong> to{' '}
                <strong>{PATIENT_STAGE_LABELS[confirmStage]}</strong>?
              </p>
            </div>
            <div className="flex border-t border-gray-100">
              <button onClick={() => setConfirmStage(null)} className="flex-1 py-3.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <div className="w-px bg-gray-100" />
              <button
                onClick={() => handleAdvanceStage(confirmStage)}
                disabled={advancing}
                className="flex-1 py-3.5 text-sm font-semibold text-even-blue hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                {advancing ? 'Moving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
