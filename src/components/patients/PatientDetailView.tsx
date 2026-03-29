'use client';

// ============================================
// PatientDetailView — full patient detail panel.
// Shows: stage progress bar, patient info, advance
// stage button, form history, open channel link.
// Step 6.2b: Deferred UX items
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
} from 'lucide-react';
import type { PatientStage, FormType, FormStatus } from '@/types';
import {
  PATIENT_STAGE_LABELS,
  PATIENT_STAGE_COLORS,
} from '@/types';
import { FORM_TYPE_LABELS, FORMS_BY_STAGE } from '@/lib/form-registry';

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

// Valid stage transitions (mirror of backend)
const VALID_TRANSITIONS: Record<string, string[]> = {
  opd: ['pre_admission'],
  pre_admission: ['admitted', 'opd'],
  admitted: ['pre_op', 'discharge'],
  pre_op: ['surgery', 'admitted'],
  surgery: ['post_op'],
  post_op: ['discharge', 'surgery'],
  discharge: ['post_discharge', 'admitted'],
  post_discharge: [],
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

interface PatientDetail {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: PatientStage;
  primary_consultant_name: string | null;
  department_name: string | null;
  department_id: string | null;
  getstream_channel_id: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  created_at: string;
  forms: FormEntry[];
}

interface PatientDetailViewProps {
  patientId: string;
  onBack: () => void;
  onOpenChannel?: (channelId: string) => void;
}

// ── Status badge colors ──
const STATUS_COLORS: Record<FormStatus, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-700' },
  reviewed: { bg: 'bg-green-50', text: 'text-green-700' },
  flagged: { bg: 'bg-red-50', text: 'text-red-700' },
};

export function PatientDetailView({
  patientId,
  onBack,
  onOpenChannel,
}: PatientDetailViewProps) {
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchPatient = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}`);
      const data = await res.json();
      if (data.success) {
        setPatient(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch patient detail:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchPatient();
  }, [fetchPatient]);

  const handleAdvanceStage = async (newStage: PatientStage) => {
    if (!patient) return;
    setAdvancing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/patients/${patient.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({
          type: 'success',
          text: `Stage advanced to ${PATIENT_STAGE_LABELS[newStage]}`,
        });
        fetchPatient(); // Refresh data
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to advance stage' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error' });
    } finally {
      setAdvancing(false);
    }
  };

  // ── Loading state ──
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
  const nextStages = VALID_TRANSITIONS[patient.current_stage] || [];
  // Only show forward transitions as primary action (filter out backward ones for the main button)
  const forwardStages = nextStages.filter(
    (s) => STAGES_ORDERED.indexOf(s as PatientStage) > currentStageIdx
  );
  const backwardStages = nextStages.filter(
    (s) => STAGES_ORDERED.indexOf(s as PatientStage) <= currentStageIdx
  );

  // Forms relevant to this stage
  const stageForms = [
    ...(FORMS_BY_STAGE[patient.current_stage] || []),
    ...(FORMS_BY_STAGE['any'] || []),
  ];

  // Completed form types
  const completedFormTypes = new Set(
    (patient.forms || []).map((f) => f.form_type)
  );

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} className="text-even-navy" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-even-navy truncate">
              {patient.patient_name}
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {patient.uhid && (
                <span className="flex items-center gap-1">
                  <Hash size={10} />
                  {patient.uhid}
                </span>
              )}
              {patient.ip_number && (
                <span>IP: {patient.ip_number}</span>
              )}
            </div>
          </div>
          {/* Open channel button */}
          {patient.getstream_channel_id && onOpenChannel && (
            <button
              onClick={() => onOpenChannel(patient.getstream_channel_id!)}
              className="flex items-center gap-1.5 px-3 py-2 bg-even-blue text-white rounded-lg text-xs font-medium"
            >
              <MessageSquare size={14} />
              Chat
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pb-20">
        {/* ── Stage Progress Bar ── */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-0.5">
            {STAGES_ORDERED.map((stage, idx) => {
              const isCompleted = idx < currentStageIdx;
              const isCurrent = idx === currentStageIdx;
              const color = PATIENT_STAGE_COLORS[stage];
              return (
                <div key={stage} className="flex-1 flex flex-col items-center">
                  {/* Bar segment */}
                  <div
                    className="w-full h-2 rounded-full"
                    style={{
                      backgroundColor: isCompleted || isCurrent ? color : '#E5E7EB',
                      opacity: isCompleted ? 0.5 : 1,
                    }}
                  />
                  {/* Label — only show for current and neighbours */}
                  {(isCurrent || idx === currentStageIdx - 1 || idx === currentStageIdx + 1) && (
                    <span
                      className={`text-[9px] mt-1 text-center leading-tight ${
                        isCurrent ? 'font-bold' : 'text-gray-400'
                      }`}
                      style={isCurrent ? { color } : undefined}
                    >
                      {PATIENT_STAGE_LABELS[stage]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Current stage badge */}
          <div className="flex items-center justify-center mt-3">
            <span
              className="text-xs font-semibold px-3 py-1 rounded-full text-white"
              style={{ backgroundColor: PATIENT_STAGE_COLORS[patient.current_stage] }}
            >
              {PATIENT_STAGE_LABELS[patient.current_stage]}
            </span>
          </div>
        </div>

        {/* ── Patient Info Card ── */}
        <div className="mx-4 bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="space-y-2.5">
            {patient.primary_consultant_name && (
              <div className="flex items-center gap-2.5 text-sm">
                <User size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Consultant:</span>
                <span className="text-even-navy font-medium">
                  {patient.primary_consultant_name}
                </span>
              </div>
            )}
            {patient.department_name && (
              <div className="flex items-center gap-2.5 text-sm">
                <Building2 size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Department:</span>
                <span className="text-even-navy font-medium">
                  {patient.department_name}
                </span>
              </div>
            )}
            {patient.admission_date && (
              <div className="flex items-center gap-2.5 text-sm">
                <Calendar size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Admitted:</span>
                <span className="text-even-navy font-medium">
                  {new Date(patient.admission_date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
            {patient.discharge_date && (
              <div className="flex items-center gap-2.5 text-sm">
                <Calendar size={14} className="text-gray-400 shrink-0" />
                <span className="text-gray-500">Discharged:</span>
                <span className="text-even-navy font-medium">
                  {new Date(patient.discharge_date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-sm">
              <Clock size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-500">Created:</span>
              <span className="text-even-navy font-medium">
                {new Date(patient.created_at).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* ── Toast ── */}
        {msg && (
          <div
            className={`mx-4 mb-4 p-2.5 rounded-lg flex items-center gap-2 text-xs ${
              msg.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.type === 'success' ? (
              <CheckCircle size={14} />
            ) : (
              <AlertCircle size={14} />
            )}
            {msg.text}
          </div>
        )}

        {/* ── Advance Stage ── */}
        {nextStages.length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Advance Stage
            </h3>
            <div className="flex flex-col gap-2">
              {forwardStages.map((stage) => (
                <button
                  key={stage}
                  onClick={() => handleAdvanceStage(stage as PatientStage)}
                  disabled={advancing}
                  className="w-full flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100 hover:border-even-blue/30 hover:shadow-sm transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: PATIENT_STAGE_COLORS[stage as PatientStage] }}
                    />
                    <span className="text-sm font-medium text-even-navy">
                      Advance to {PATIENT_STAGE_LABELS[stage as PatientStage]}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ))}
              {backwardStages.length > 0 && (
                <div className="border-t border-gray-100 pt-2 mt-1">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5 px-1">
                    Corrections
                  </p>
                  {backwardStages.map((stage) => (
                    <button
                      key={stage}
                      onClick={() => handleAdvanceStage(stage as PatientStage)}
                      disabled={advancing}
                      className="w-full flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-left hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: PATIENT_STAGE_COLORS[stage as PatientStage] }}
                        />
                        <span className="text-xs text-gray-600">
                          Move back to {PATIENT_STAGE_LABELS[stage as PatientStage]}
                        </span>
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
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Forms for this Stage
          </h3>
          {stageForms.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No forms for this stage.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stageForms.map((formType) => {
                const done = completedFormTypes.has(formType);
                return (
                  <a
                    key={formType}
                    href={`/forms/new?type=${formType}&patient=${patient.id}`}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow"
                  >
                    <FileText
                      size={16}
                      className={done ? 'text-green-500' : 'text-gray-300'}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-even-navy">
                        {FORM_TYPE_LABELS[formType]}
                      </span>
                    </div>
                    {done ? (
                      <CheckCircle size={14} className="text-green-500 shrink-0" />
                    ) : (
                      <span className="text-[10px] text-gray-400 shrink-0">New</span>
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
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Form History ({patient.forms.length})
            </h3>
            <div className="flex flex-col gap-1.5">
              {patient.forms.map((form) => {
                const statusStyle = STATUS_COLORS[form.status] || STATUS_COLORS.draft;
                const score =
                  form.completion_score != null
                    ? Math.round(form.completion_score * 100)
                    : null;
                return (
                  <a
                    key={form.id}
                    href={`/forms/${form.id}`}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-shadow"
                  >
                    <FileText size={16} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-even-navy truncate">
                          {FORM_TYPE_LABELS[form.form_type] || form.form_type}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusStyle.bg} ${statusStyle.text}`}
                        >
                          {form.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        {form.submitted_by_name && (
                          <span>{form.submitted_by_name}</span>
                        )}
                        <span>
                          {new Date(form.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        {score !== null && (
                          <span
                            className={
                              score >= 80
                                ? 'text-green-600'
                                : score >= 50
                                ? 'text-orange-500'
                                : 'text-red-500'
                            }
                          >
                            {score}%
                          </span>
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
      </div>
    </div>
  );
}
