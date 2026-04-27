'use client';

import Link from 'next/link';

// ============================================
// FormsView — Standalone Forms module (5th tab)
// Flow: Browse all forms → Pick a form → Select patient → Fill & submit
// Submissions post to patient chat AND submitter's department chat
// ============================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, ChevronRight, ArrowLeft, CheckCircle, AlertCircle,
  ClipboardList, Users, FileText, X,
  PenLine,
} from 'lucide-react';
import FormRenderer from '@/components/forms/FormRenderer';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  type FormSchema,
} from '@/lib/form-registry';
import { PATIENT_STAGE_LABELS, PATIENT_STAGE_COLORS } from '@/types';
import type { FormType } from '@/types';

// ─── Types ───────────────────────────────────────────

interface PatientOption {
  id: string;
  patient_name: string;
  uhid: string | null;
  ip_number: string | null;
  current_stage: string;
  department_name: string | null;
  getstream_channel_id: string | null;
}

interface RecentSubmission {
  id: string;
  form_type: string;
  status: string;
  // 26 Apr 2026 (FORMS.1+2): API returns these field names — earlier code
  // referenced 'submitter_name' which never matched, so every row showed 'Unknown'.
  submitted_by_name?: string | null;
  patient_name?: string | null;
  uhid?: string | null;
  patient_stage?: string | null;
  created_at: string;
  // Version chain — populated by the POST handler's version-linking pass
  // (src/app/api/forms/route.ts ~line 274-315).
  version_number?: number | null;
  parent_submission_id?: string | null;
}

type ViewState = 'list' | 'pick-patient' | 'fill' | 'success';

// ─── All form types in display order ─────────────────
// Sprint 1 Day 3 pruned pre_op_nursing_checklist, who_safety_checklist,
// nursing_shift_handoff from FORMS_BY_STAGE in form-registry.ts but missed this
// component-local array. Sprint 2 follow-up #28 (24 Apr) removes them here too.

const ALL_FORMS: { type: FormType; stages: string[] }[] = [
  { type: 'consolidated_marketing_handoff', stages: ['opd', 'pre_admission'] },
  { type: 'admission_advice', stages: ['opd', 'pre_admission'] },
  { type: 'financial_counseling', stages: ['admitted', 'pre_op'] },
  { type: 'surgery_booking', stages: ['admitted', 'pre_op'] },
  { type: 'admission_checklist', stages: ['admitted'] },
  { type: 'surgery_posting', stages: ['pre_op'] },
  { type: 'ot_billing_clearance', stages: ['pre_op'] },
  { type: 'pac_clearance', stages: ['pre_op'] },
  { type: 'discharge_readiness', stages: ['discharge'] },
  { type: 'post_discharge_followup', stages: ['post_discharge'] },
  { type: 'daily_department_update', stages: ['any'] },
];

// ─── Stage badge colors ──────────────────────────────

function stageBadge(stage: string) {
  if (stage === 'any') return { label: 'Any Stage', color: '#9CA3AF' };
  return {
    label: PATIENT_STAGE_LABELS[stage as keyof typeof PATIENT_STAGE_LABELS] || stage,
    color: PATIENT_STAGE_COLORS[stage as keyof typeof PATIENT_STAGE_COLORS] || '#6B7280',
  };
}

// ─── Form description from registry ──────────────────

function getFormDescription(formType: FormType): string {
  const schema = FORM_REGISTRY[formType];
  return schema?.description || '';
}

// ─── FormsView Component ─────────────────────────────

export function FormsView() {
  const [view, setView] = useState<ViewState>('list');
  const [search, setSearch] = useState('');

  // Selected form
  const [selectedFormType, setSelectedFormType] = useState<FormType | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<FormSchema | null>(null);

  // Patient picker
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);

  // Form submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [createdFormId, setCreatedFormId] = useState('');

  // Recent submissions
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);

  // ── Load recent submissions on mount ──
  useEffect(() => {
    fetch('/api/forms?limit=10')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch forms: ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.success) setRecentSubmissions(d.data);
      })
      .catch((err) => console.warn('[FormsView] Recent submissions fetch failed:', err));
  }, []);

  // ── Load patients when entering patient picker ──
  useEffect(() => {
    if (view !== 'pick-patient') return;
    setPatientsLoading(true);
    fetch('/api/patients?limit=200&include_archived=false')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch patients: ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.success && d.data) {
          setPatients(d.data);
        }
      })
      .catch((err) => console.warn('[FormsView] Patient list fetch failed:', err))
      .finally(() => setPatientsLoading(false));
  }, [view]);

  // ── Form selection ──
  const handleSelectForm = useCallback((formType: FormType) => {
    const schema = FORM_REGISTRY[formType];
    if (!schema) return;
    setSelectedFormType(formType);
    setSelectedSchema(schema);
    setPatientSearch('');
    setSelectedPatient(null);
    setView('pick-patient');
  }, []);

  // ── Patient selection ──
  const handleSelectPatient = useCallback((patient: PatientOption) => {
    setSelectedPatient(patient);
    setSubmitError('');
    setView('fill');
  }, []);

  // ── Form submit ──
  const handleSubmit = useCallback(
    async (formData: Record<string, unknown>, completionScore: number) => {
      if (!selectedFormType || !selectedPatient) return;
      setIsSubmitting(true);
      setSubmitError('');

      try {
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_type: selectedFormType,
            form_data: formData,
            patient_thread_id: selectedPatient.id,
            // Pass the patient's GetStream channel so the API posts the card there
            getstream_channel_type: 'patient-thread',
            getstream_channel_id: selectedPatient.getstream_channel_id || undefined,
            // Flag to also post to submitter's department channel
            post_to_department: true,
            completion_score: completionScore,
            status: 'submitted',
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to submit form');
        }

        setCreatedFormId(data.data.id);
        setView('success');
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedFormType, selectedPatient]
  );

  // ── Draft save ──
  const handleSaveDraft = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!selectedFormType || !selectedPatient) return;
      try {
        const res = await fetch('/api/forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_type: selectedFormType,
            form_data: formData,
            patient_thread_id: selectedPatient.id,
            status: 'draft',
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setCreatedFormId(data.data.id);
          // Show a brief toast-like confirmation
          alert('Draft saved successfully');
        }
      } catch {
        alert('Failed to save draft');
      }
    },
    [selectedFormType, selectedPatient]
  );

  // ── Back handlers ──
  const handleBackToList = useCallback(() => {
    setView('list');
    setSelectedFormType(null);
    setSelectedSchema(null);
    setSelectedPatient(null);
    setSubmitError('');
    setCreatedFormId('');
    // Refresh recent submissions
    fetch('/api/forms?limit=10')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to refresh forms: ${r.status}`);
        return r.json();
      })
      .then(d => { if (d.success) setRecentSubmissions(d.data); })
      .catch((err) => console.warn('[FormsView] Refresh submissions failed:', err));
  }, []);

  const handleBackToPatientPicker = useCallback(() => {
    setView('pick-patient');
    setSelectedPatient(null);
    setSubmitError('');
  }, []);

  // ── Filtered forms ──
  const filteredForms = ALL_FORMS.filter(f => {
    if (!search) return true;
    const q = search.toLowerCase();
    const label = (FORM_TYPE_LABELS[f.type] || f.type).toLowerCase();
    const desc = getFormDescription(f.type).toLowerCase();
    return label.includes(q) || desc.includes(q) || f.stages.some(s => s.includes(q));
  });

  // ── Filtered patients ──
  const filteredPatients = patients.filter(p => {
    if (!patientSearch) return true;
    const q = patientSearch.toLowerCase();
    return (
      p.patient_name.toLowerCase().includes(q) ||
      (p.uhid || '').toLowerCase().includes(q) ||
      (p.ip_number || '').toLowerCase().includes(q) ||
      (p.department_name || '').toLowerCase().includes(q)
    );
  });

  // ═══════════════════════════════════════════
  // RENDER: Form List
  // ═══════════════════════════════════════════
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3">
          <h1 className="text-lg font-bold text-even-navy">Forms</h1>
          <p className="text-xs text-gray-500 mt-0.5">Select a form to fill for a patient</p>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search forms…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue/20 focus:border-even-blue bg-white"
            />
          </div>

          {/* All Forms */}
          <div className="space-y-2 mb-6">
            {filteredForms.map(f => {
              const label = FORM_TYPE_LABELS[f.type] || f.type;
              const desc = getFormDescription(f.type);

              return (
                <button
                  key={f.type}
                  onClick={() => handleSelectForm(f.type)}
                  className="w-full text-left bg-white border border-gray-100 rounded-lg px-4 py-3 hover:shadow-md hover:border-even-blue/30 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-even-blue" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-even-navy">{label}</div>
                      {desc && <div className="text-xs text-gray-500 truncate mt-0.5">{desc}</div>}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {f.stages.map(s => {
                          const b = stageBadge(s);
                          return (
                            <span
                              key={s}
                              className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded text-white"
                              style={{ backgroundColor: b.color }}
                            >
                              {b.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-even-blue shrink-0" />
                  </div>
                </button>
              );
            })}

            {filteredForms.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">No forms match your search</div>
            )}
          </div>

          {/* Recent Submissions */}
          {recentSubmissions.length > 0 && !search && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent Submissions</h2>
              <div className="space-y-1.5">
                {recentSubmissions.map(s => {
                  const dt = new Date(s.created_at);
                  const dateLine = dt.toLocaleString('en-IN', {
                    day: '2-digit', month: 'short',
                    hour: 'numeric', minute: '2-digit', hour12: true,
                  });
                  const ver = s.version_number || 0;
                  const isResubmission = ver > 1;
                  const formLabel = FORM_TYPE_LABELS[s.form_type as FormType] || s.form_type;
                  return (
                    <Link
                      key={s.id}
                      href={`/forms/${s.id}`}
                      className="bg-white border border-gray-100 rounded-lg px-3 py-2.5 flex items-start gap-3 hover:border-even-blue/40 hover:bg-blue-50/30 active:bg-blue-50 transition-colors group"
                    >
                      <ClipboardList size={16} className="text-gray-400 group-hover:text-even-blue shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        {/* Title + version chip */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-even-navy truncate">{formLabel}</span>
                          {ver > 0 && (
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                              isResubmission ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              v{ver}
                              {isResubmission && ' · revised'}
                            </span>
                          )}
                        </div>
                        {/* Patient line */}
                        {s.patient_name ? (
                          <div className="text-[11px] text-gray-700 mt-0.5 flex items-center gap-1 truncate">
                            <User size={10} className="text-gray-400 shrink-0" />
                            <span className="font-medium">{s.patient_name}</span>
                            {s.uhid && <span className="text-gray-400">· {s.uhid}</span>}
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-400 italic mt-0.5">No patient linked</div>
                        )}
                        {/* Submitter + datetime line */}
                        <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1">
                          <PenLine size={9} className="text-gray-400 shrink-0" />
                          <span className="truncate">
                            {s.submitted_by_name || 'Unknown user'} · {dateLine}
                          </span>
                        </div>
                      </div>
                      {/* Status pill + chevron stack */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          s.status === 'submitted' ? 'bg-green-50 text-green-600' :
                          s.status === 'draft' ? 'bg-gray-50 text-gray-500' :
                          'bg-blue-50 text-blue-600'
                        }`}>
                          {s.status}
                        </span>
                        <ChevronRight size={14} className="text-gray-300 group-hover:text-even-blue transition-colors" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: Patient Picker
  // ═══════════════════════════════════════════
  if (view === 'pick-patient') {
    const formLabel = selectedFormType ? (FORM_TYPE_LABELS[selectedFormType] || selectedFormType) : 'Form';

    return (
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToList}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-even-navy truncate">{formLabel}</h1>
              <p className="text-xs text-gray-500">Select a patient for this form</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Patient search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, UHID, IP number…"
              value={patientSearch}
              onChange={e => setPatientSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue/20 focus:border-even-blue bg-white"
              autoFocus
            />
          </div>

          {patientsLoading ? (
            <div className="text-center py-12">
              <div className="inline-block w-5 h-5 border-2 border-even-blue border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400 mt-2">Loading patients…</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPatients.map(p => {
                const stageLabel = PATIENT_STAGE_LABELS[p.current_stage as keyof typeof PATIENT_STAGE_LABELS] || p.current_stage;
                const stageColor = PATIENT_STAGE_COLORS[p.current_stage as keyof typeof PATIENT_STAGE_COLORS] || '#6B7280';

                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPatient(p)}
                    className="w-full text-left bg-white border border-gray-100 rounded-lg px-4 py-3 hover:shadow-md hover:border-even-blue/30 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-even-navy text-sm truncate">{p.patient_name}</span>
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-white shrink-0"
                            style={{ backgroundColor: stageColor }}
                          >
                            {stageLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          {p.uhid && <span>UHID: {p.uhid}</span>}
                          {p.ip_number && <span>IP: {p.ip_number}</span>}
                          {p.department_name && <span>{p.department_name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-even-blue shrink-0 ml-2" />
                    </div>
                  </button>
                );
              })}

              {filteredPatients.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {patientSearch ? 'No patients match your search' : 'No active patients found'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: Fill Form
  // ═══════════════════════════════════════════
  if (view === 'fill' && selectedSchema && selectedPatient && selectedFormType) {
    const formLabel = FORM_TYPE_LABELS[selectedFormType] || selectedFormType;

    // Stage mismatch warning
    const formStages = ALL_FORMS.find(f => f.type === selectedFormType)?.stages || [];
    const isStageMatch = formStages.includes('any') || formStages.includes(selectedPatient.current_stage);

    return (
      <div className="h-full flex flex-col bg-gray-50">
        {/* Header */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToPatientPicker}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-even-navy truncate">{formLabel}</h1>
              <p className="text-xs text-gray-500 truncate">
                Patient: {selectedPatient.patient_name}
                {selectedPatient.uhid && ` (${selectedPatient.uhid})`}
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Stage mismatch warning */}
          {!isStageMatch && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800">
                <strong>Note:</strong> This form is typically used for patients at the{' '}
                {formStages.map(s => stageBadge(s).label).join(' / ')} stage.{' '}
                {selectedPatient.patient_name} is currently at{' '}
                <strong>{PATIENT_STAGE_LABELS[selectedPatient.current_stage as keyof typeof PATIENT_STAGE_LABELS] || selectedPatient.current_stage}</strong>.
                You can still submit it.
              </p>
            </div>
          )}

          {/* Error banner */}
          {submitError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-800">Submission Failed</p>
                <p className="text-xs text-red-700 mt-0.5">{submitError}</p>
              </div>
            </div>
          )}

          <FormRenderer
            schema={selectedSchema}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
            isSubmitting={isSubmitting}
            patientId={selectedPatient?.id}
          />
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: Success
  // ═══════════════════════════════════════════
  if (view === 'success') {
    const formLabel = selectedFormType ? (FORM_TYPE_LABELS[selectedFormType] || selectedFormType) : 'Form';

    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl border border-gray-100 p-8 max-w-sm w-full text-center shadow-sm">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-even-navy">Form Submitted</h2>
          <p className="mt-2 text-sm text-gray-600">
            {formLabel} for <strong>{selectedPatient?.patient_name}</strong> has been submitted successfully.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            The submission has been posted to the patient&apos;s chat and your department chat.
          </p>
          {createdFormId && (
            <p className="mt-2 text-[10px] text-gray-400 font-mono">ID: {createdFormId}</p>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={handleBackToList}
              className="w-full px-4 py-2.5 bg-even-blue text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Submit Another Form
            </button>
            {createdFormId && (
              <button
                onClick={() => window.open(`/forms/${createdFormId}`, '_blank')}
                className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
              >
                View Submitted Form
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return null;
}
