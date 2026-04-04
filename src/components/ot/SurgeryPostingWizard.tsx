'use client';

// ============================================
// SurgeryPostingWizard — 3-step mobile-first
// Step 1: Patient + Procedure (smart defaults)
// Step 2: Team + Schedule
// Step 3: Review + Post
// ============================================

import React, { useState, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react';
import { COMMON_PROCEDURES, KNOWN_SURGEONS, KNOWN_ANAESTHESIOLOGISTS } from '@/lib/ot/procedure-defaults';
import { getProcedureDefaults } from '@/lib/ot/procedure-defaults';
import { trackFeature } from '@/lib/session-tracker';

interface WizardProps {
  onClose: () => void;
  onPosted: () => void;
  /** Pre-fill patient if launched from PatientDetailView */
  prefillPatient?: {
    patient_thread_id: string;
    patient_name: string;
    uhid?: string;
    ip_number?: string;
  };
}

type Side = 'Left' | 'Right' | 'Bilateral' | 'N/A' | 'Midline';
type CaseType = 'Elective' | 'Emergency' | 'Day Care';

const SIDES: Side[] = ['Left', 'Right', 'Bilateral', 'N/A', 'Midline'];
const CASE_TYPES: CaseType[] = ['Elective', 'Emergency', 'Day Care'];
const OT_ROOMS = [1, 2, 3, 4];
const TIME_SLOTS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
];

export function SurgeryPostingWizard({ onClose, onPosted, prefillPatient }: WizardProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1: Patient + Procedure ──
  const [patientName, setPatientName] = useState(prefillPatient?.patient_name || '');
  const [patientThreadId] = useState(prefillPatient?.patient_thread_id || '');
  const [uhid, setUhid] = useState(prefillPatient?.uhid || '');
  const [ipNumber, setIpNumber] = useState(prefillPatient?.ip_number || '');
  const [procedureName, setProcedureName] = useState('');
  const [procedureSearch, setProcedureSearch] = useState('');
  const [showProcedureList, setShowProcedureList] = useState(false);
  const [side, setSide] = useState<Side>('N/A');
  const [caseType, setCaseType] = useState<CaseType>('Elective');

  // Auto-suggested from procedure defaults
  const [woundClass, setWoundClass] = useState('');
  const [anaesthesiaType, setAnaesthesiaType] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [bloodRequired, setBloodRequired] = useState(false);
  const [implantRequired, setImplantRequired] = useState(false);

  // ── Step 2: Team + Schedule ──
  const [surgeonName, setSurgeonName] = useState('');
  const [surgeonSearch, setSurgeonSearch] = useState('');
  const [showSurgeonList, setShowSurgeonList] = useState(false);
  const [anaesthesiologistName, setAnaesthesiologistName] = useState('');
  const [anaesthSearch, setAnaesthSearch] = useState('');
  const [showAnaesthList, setShowAnaesthList] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [otRoom, setOtRoom] = useState(1);
  const [scheduledTime, setScheduledTime] = useState('');
  const [assistantSurgeon, setAssistantSurgeon] = useState('');
  const [showOptionalTeam, setShowOptionalTeam] = useState(false);
  const [scrubNurse, setScrubNurse] = useState('');
  const [circulatingNurse, setCirculatingNurse] = useState('');
  const [otTechnician, setOtTechnician] = useState('');

  // ── Step 3: Review + Post ──
  const [postOpDestination, setPostOpDestination] = useState('PACU');
  const [notes, setNotes] = useState('');

  // Set default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split('T')[0]);
  }, []);

  // Apply procedure defaults when procedure selected
  useEffect(() => {
    if (!procedureName) return;
    const defaults = getProcedureDefaults(procedureName);
    if (defaults) {
      setWoundClass(defaults.wound_class || '');
      setAnaesthesiaType(defaults.anaesthesia_type || '');
      setEstimatedDuration(defaults.estimated_duration_minutes);
      setBloodRequired(defaults.typically_requires_blood);
      setImplantRequired(defaults.typically_requires_implant);
      setPostOpDestination(defaults.post_op_destination || 'PACU');
    }
  }, [procedureName]);

  // Filtered procedure list
  const filteredProcedures = procedureSearch
    ? COMMON_PROCEDURES.filter(p => p.toLowerCase().includes(procedureSearch.toLowerCase()))
    : COMMON_PROCEDURES;

  // Filtered surgeon list
  const filteredSurgeons = surgeonSearch
    ? KNOWN_SURGEONS.filter(s => s.name.toLowerCase().includes(surgeonSearch.toLowerCase()))
    : KNOWN_SURGEONS;

  // Filtered anaesthesiologist list
  const filteredAnaesths = anaesthSearch
    ? KNOWN_ANAESTHESIOLOGISTS.filter(a => a.name.toLowerCase().includes(anaesthSearch.toLowerCase()))
    : KNOWN_ANAESTHESIOLOGISTS;

  const canProceedStep1 = patientName && procedureName && side;
  const canProceedStep2 = surgeonName && anaesthesiologistName && scheduledDate && otRoom;

  const handlePost = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        patient_name: patientName,
        patient_thread_id: patientThreadId || null,
        uhid: uhid || null,
        ip_number: ipNumber || null,
        procedure_name: procedureName,
        procedure_side: side,
        case_type: caseType,
        wound_class: woundClass || null,
        anaesthesia_type: anaesthesiaType || null,
        estimated_duration_minutes: estimatedDuration,
        blood_required: bloodRequired,
        implant_required: implantRequired,
        primary_surgeon_name: surgeonName,
        anaesthesiologist_name: anaesthesiologistName,
        assistant_surgeon_name: assistantSurgeon || null,
        scrub_nurse_name: scrubNurse || null,
        circulating_nurse_name: circulatingNurse || null,
        ot_technician_name: otTechnician || null,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime || null,
        ot_room: otRoom,
        post_op_destination: postOpDestination,
        icu_bed_required: postOpDestination === 'ICU',
        notes: notes || null,
        posted_via: 'wizard',
      };

      const res = await fetch('/api/ot/postings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      trackFeature('ot_surgery_posted', { procedure: procedureName, case_type: caseType, ot_room: otRoom });
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post surgery');
    } finally {
      setLoading(false);
    }
  }, [
    patientName, patientThreadId, uhid, ipNumber, procedureName, side, caseType,
    woundClass, anaesthesiaType, estimatedDuration, bloodRequired, implantRequired,
    surgeonName, anaesthesiologistName, assistantSurgeon, scrubNurse, circulatingNurse,
    otTechnician, scheduledDate, scheduledTime, otRoom, postOpDestination, notes, onPosted,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              Post Surgery {step > 1 ? `(${step}/3)` : ''}
            </h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
          {/* Step indicator */}
          <div className="flex gap-1.5 mt-2">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            ))}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── STEP 1: Patient + Procedure ── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Patient name */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Patient <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="Patient name"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-300"
                  disabled={!!prefillPatient}
                />
                {uhid && <p className="text-[10px] text-gray-400 mt-0.5 px-1">UHID: {uhid} {ipNumber ? `| IP#: ${ipNumber}` : ''}</p>}
              </div>

              {/* Procedure — autocomplete */}
              <div className="relative">
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Procedure <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={procedureName || procedureSearch}
                    onChange={e => {
                      setProcedureSearch(e.target.value);
                      setProcedureName('');
                      setShowProcedureList(true);
                    }}
                    onFocus={() => setShowProcedureList(true)}
                    placeholder="Search or type procedure..."
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:border-blue-300"
                  />
                  <Search size={14} className="absolute right-3 top-3 text-gray-400" />
                </div>
                {showProcedureList && filteredProcedures.length > 0 && !procedureName && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredProcedures.map(p => (
                      <button
                        key={p}
                        onClick={() => {
                          setProcedureName(p);
                          setProcedureSearch('');
                          setShowProcedureList(false);
                        }}
                        className="w-full text-left text-sm px-3 py-2 hover:bg-blue-50 transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Side — chip selection */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                  Side <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {SIDES.map(s => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        side === s
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Case type */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Case Type</label>
                <div className="flex gap-2">
                  {CASE_TYPES.map(ct => (
                    <button
                      key={ct}
                      onClick={() => setCaseType(ct)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        caseType === ct
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-suggested fields */}
              {procedureName && (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Auto-suggested (editable)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500">Wound Class</label>
                      <select value={woundClass} onChange={e => setWoundClass(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">—</option>
                        <option value="Clean">Clean</option>
                        <option value="Clean-Contaminated">Clean-Contaminated</option>
                        <option value="Dirty">Dirty</option>
                        <option value="Infected">Infected</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Anaesthesia</label>
                      <select value={anaesthesiaType} onChange={e => setAnaesthesiaType(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">—</option>
                        <option value="GA">GA</option>
                        <option value="SA">SA</option>
                        <option value="Regional">Regional</option>
                        <option value="LA">LA</option>
                        <option value="Block">Block</option>
                        <option value="Sedation">Sedation</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Duration (min)</label>
                      <input type="number" value={estimatedDuration ?? ''} onChange={e => setEstimatedDuration(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white" />
                    </div>
                    <div className="flex items-end gap-3 pb-1">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={bloodRequired} onChange={e => setBloodRequired(e.target.checked)} className="rounded" /> Blood
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={implantRequired} onChange={e => setImplantRequired(e.target.checked)} className="rounded" /> Implant
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Team + Schedule ── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Primary surgeon — autocomplete */}
              <div className="relative">
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Primary Surgeon <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={surgeonName || surgeonSearch}
                    onChange={e => { setSurgeonSearch(e.target.value); setSurgeonName(''); setShowSurgeonList(true); }}
                    onFocus={() => setShowSurgeonList(true)}
                    placeholder="Search surgeon..."
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:border-blue-300"
                  />
                  <Search size={14} className="absolute right-3 top-3 text-gray-400" />
                </div>
                {showSurgeonList && filteredSurgeons.length > 0 && !surgeonName && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {filteredSurgeons.map(s => (
                      <button key={s.name} onClick={() => { setSurgeonName(s.name); setSurgeonSearch(''); setShowSurgeonList(false); }}
                        className="w-full text-left text-sm px-3 py-2 hover:bg-blue-50">
                        <span>{s.name}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{s.specialty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Anaesthesiologist — autocomplete */}
              <div className="relative">
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Anaesthesiologist <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={anaesthesiologistName || anaesthSearch}
                    onChange={e => { setAnaesthSearch(e.target.value); setAnaesthesiologistName(''); setShowAnaesthList(true); }}
                    onFocus={() => setShowAnaesthList(true)}
                    placeholder="Search anaesthesiologist..."
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:border-blue-300"
                  />
                  <Search size={14} className="absolute right-3 top-3 text-gray-400" />
                </div>
                {showAnaesthList && filteredAnaesths.length > 0 && !anaesthesiologistName && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {filteredAnaesths.map(a => (
                      <button key={a.name} onClick={() => { setAnaesthesiologistName(a.name); setAnaesthSearch(''); setShowAnaesthList(false); }}
                        className="w-full text-left text-sm px-3 py-2 hover:bg-blue-50">
                        <span>{a.name}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{a.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Date + OT Room */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-300" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    OT Room <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1.5">
                    {OT_ROOMS.map(r => (
                      <button key={r} onClick={() => setOtRoom(r)}
                        className={`flex-1 text-sm py-2.5 rounded-xl font-medium transition-colors ${
                          otRoom === r ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Time */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Time (optional)</label>
                <select value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:border-blue-300">
                  <option value="">No specific time</option>
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Optional team */}
              <button onClick={() => setShowOptionalTeam(!showOptionalTeam)}
                className="text-xs text-blue-600 font-medium hover:text-blue-800">
                {showOptionalTeam ? '▾ Hide optional team fields' : '▸ Fill later (optional team)'}
              </button>
              {showOptionalTeam && (
                <div className="space-y-2 bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <input type="text" placeholder="Assistant Surgeon" value={assistantSurgeon}
                    onChange={e => setAssistantSurgeon(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white" />
                  <input type="text" placeholder="Scrub Nurse" value={scrubNurse}
                    onChange={e => setScrubNurse(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white" />
                  <input type="text" placeholder="Circulating Nurse" value={circulatingNurse}
                    onChange={e => setCirculatingNurse(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white" />
                  <input type="text" placeholder="OT Technician" value={otTechnician}
                    onChange={e => setOtTechnician(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white" />
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review + Post ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <p className="text-sm font-semibold text-gray-900">
                  {procedureName} — {side}
                </p>
                <p className="text-xs text-gray-600 mt-1">{surgeonName}</p>
                <p className="text-xs text-gray-500">
                  {scheduledDate}{scheduledTime ? `, ${scheduledTime}` : ''} — OT {otRoom}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500">
                  {woundClass && <span>{woundClass}</span>}
                  {anaesthesiaType && <span>{anaesthesiaType}</span>}
                  {estimatedDuration && <span>~{estimatedDuration}min</span>}
                  {bloodRequired && <span className="text-red-600">Blood: Yes</span>}
                  {implantRequired && <span className="text-amber-600">Implant: Yes</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1">Anaesthesia: {anaesthesiologistName}</p>
                <p className="text-xs text-gray-500">Post-Op: {postOpDestination}</p>
                {patientName && (
                  <p className="text-xs text-gray-500 mt-1">Patient: {patientName} {uhid ? `(${uhid})` : ''}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Post-Op Destination</label>
                <div className="flex gap-2">
                  {['PACU', 'Ward', 'ICU', 'Day Care'].map(d => (
                    <button key={d} onClick={() => setPostOpDestination(d)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        postOpDestination === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Any special instructions..."
                  rows={2}
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-300 resize-none" />
              </div>

              <p className="text-[10px] text-gray-400 px-1">
                This will generate readiness items based on your selections. All relevant teams will be notified via #ot-schedule.
              </p>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3.5 flex gap-3">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} disabled={loading}
              className="flex items-center gap-1 text-sm font-medium text-gray-600 bg-gray-100 px-4 py-2.5 rounded-xl hover:bg-gray-200 transition-colors">
              <ChevronLeft size={16} /> Back
            </button>
          ) : (
            <button onClick={onClose} className="text-sm font-medium text-gray-600 bg-gray-100 px-4 py-2.5 rounded-xl hover:bg-gray-200 transition-colors">
              Cancel
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
              className="flex items-center gap-1 text-sm font-semibold text-white bg-blue-600 px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40">
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handlePost}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-600 px-5 py-2.5 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50">
              {loading ? 'Posting...' : <>Post Surgery <Check size={16} /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
