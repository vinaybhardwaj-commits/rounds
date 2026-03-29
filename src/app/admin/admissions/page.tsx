'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Plus,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
  Stethoscope,
  BedDouble,
  CreditCard,
  Shield,
  CalendarClock,
  CircleDot,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import type {
  PatientStatus,
  SurgeryReadiness,
  DepositStatus,
  PreAuthStatus,
  AdmissionTrackerEntry,
} from '@/types';
import {
  PATIENT_STATUS_LABELS,
  PATIENT_STATUS_COLORS,
  SURGERY_READINESS_LABELS,
  SURGERY_READINESS_COLORS,
} from '@/types';

// ── Status helper ──
const statusBg = (color: string) => `${color}20`; // hex alpha

// ── Tab type ──
type ViewTab = 'board' | 'surgery' | 'discharge';

interface DeptOption { id: string; name: string; }
interface StaffOption { id: string; full_name: string; role: string; }

export default function AdmissionsPage() {
  const [admissions, setAdmissions] = useState<AdmissionTrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ViewTab>('board');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deptList, setDeptList] = useState<DeptOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);

  // Form fields
  const [fName, setFName] = useState('');
  const [fUhid, setFUhid] = useState('');
  const [fIpNumber, setFIpNumber] = useState('');
  const [fAdmDate, setFAdmDate] = useState(new Date().toISOString().slice(0, 16));
  const [fSurgeon, setFSurgeon] = useState('');
  const [fSurgeryName, setFSurgeryName] = useState('');
  const [fSurgeryDate, setFSurgeryDate] = useState('');
  const [fRoom, setFRoom] = useState('');
  const [fRoomCat, setFRoomCat] = useState('general');
  const [fFinCat, setFFinCat] = useState('insurance');
  const [fPackage, setFPackage] = useState('');
  const [fEstCost, setFEstCost] = useState('');
  const [fTpa, setFTpa] = useState('');
  const [fCoordinator, setFCoordinator] = useState('');

  // ── Fetch admissions ──
  const fetchAdmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admission-tracker');
      const data = await res.json();
      if (data.success) setAdmissions(data.data || []);
    } catch (err) {
      console.error('Failed to fetch admissions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const [deptRes, staffRes] = await Promise.all([
        fetch('/api/departments'),
        fetch('/api/profiles?status=active&limit=500'),
      ]);
      const deptData = await deptRes.json();
      const staffData = await staffRes.json();
      if (deptData.success) setDeptList(deptData.data || []);
      if (staffData.success) setStaffList(staffData.data || []);
    } catch {}
  }, []);

  useEffect(() => { fetchAdmissions(); fetchLookups(); }, [fetchAdmissions, fetchLookups]);

  // ── Create ──
  const handleCreate = async () => {
    setMsg(null);
    if (!fName || !fUhid || !fIpNumber || !fAdmDate) {
      setMsg({ type: 'error', text: 'Patient name, UHID, IP number, and admission date are required.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admission-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: fName,
          uhid: fUhid,
          ip_number: fIpNumber,
          admission_date: new Date(fAdmDate).toISOString(),
          primary_surgeon: fSurgeon || null,
          surgery_name: fSurgeryName || null,
          planned_surgery_date: fSurgeryDate ? new Date(fSurgeryDate).toISOString() : null,
          room_number: fRoom || null,
          room_category: fRoomCat,
          financial_category: fFinCat,
          package_name: fPackage || null,
          estimated_cost: fEstCost ? parseFloat(fEstCost) : null,
          tpa_name: fTpa || null,
          ip_coordinator_id: fCoordinator || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: 'Admission record created.' });
        setShowCreate(false);
        fetchAdmissions();
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to create.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Helpers ──
  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const formatDateTime = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  // ── Group by status for board view ──
  const statusGroups: PatientStatus[] = ['admitted', 'pre_op', 'in_surgery', 'post_op', 'discharge_planned'];
  const grouped = statusGroups.reduce((acc, s) => {
    acc[s] = admissions.filter(a => a.current_status === s);
    return acc;
  }, {} as Record<PatientStatus, AdmissionTrackerEntry[]>);

  // ── Surgery schedule: filter to those with planned surgery ──
  const surgerySchedule = admissions
    .filter(a => a.planned_surgery_date && a.current_status !== 'discharged')
    .sort((a, b) => new Date(a.planned_surgery_date!).getTime() - new Date(b.planned_surgery_date!).getTime());

  // ── Discharge readiness: score each admission ──
  const dischargeList = admissions
    .filter(a => !['discharged'].includes(a.current_status))
    .map(a => {
      let score = 0;
      let total = 5;
      if (a.financial_counselling_complete) score++;
      if (a.deposit_status === 'collected' || a.deposit_status === 'waived') score++;
      if (a.pre_auth_status === 'approved' || a.pre_auth_status === 'not_required') score++;
      if (a.ot_clearance_complete) score++;
      if (a.pac_complete) score++;
      if (a.physician_clearance_required) { total++; if (a.physician_clearance_done) score++; }
      if (a.cardiologist_clearance_required) { total++; if (a.cardiologist_clearance_done) score++; }
      return { ...a, readiness_score: score, readiness_total: total, readiness_pct: Math.round((score / total) * 100) };
    })
    .sort((a, b) => b.readiness_pct - a.readiness_pct);

  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'Admission Tracker'}]}>
      <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy flex items-center gap-2">
            <Activity size={24} /> Admission Tracker
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {admissions.length} active admissions
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors"
          >
            <Plus size={16} /> New Admission
          </button>
          <button
            onClick={fetchAdmissions}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'board' as ViewTab, label: 'Stage Board', icon: <CircleDot size={14} /> },
          { key: 'surgery' as ViewTab, label: 'Surgery Schedule', icon: <Stethoscope size={14} /> },
          { key: 'discharge' as ViewTab, label: 'Discharge Readiness', icon: <Shield size={14} /> },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-even-navy shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Toast */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : admissions.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
          <BedDouble size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No active admissions</p>
          <p className="text-gray-400 text-sm mt-1">Click &ldquo;New Admission&rdquo; to add a patient.</p>
        </div>
      ) : (
        <>
          {/* ── BOARD VIEW ── */}
          {tab === 'board' && (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {statusGroups.map(status => {
                const color = PATIENT_STATUS_COLORS[status];
                const items = grouped[status] || [];
                return (
                  <div key={status} className="min-w-0">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm font-semibold text-gray-700">
                        {PATIENT_STATUS_LABELS[status]}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">{items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {items.length === 0 ? (
                        <div className="text-xs text-gray-300 text-center py-4 border border-dashed border-gray-200 rounded-lg">
                          No patients
                        </div>
                      ) : (
                        items.map(a => (
                          <div
                            key={a.id}
                            className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-sm transition-shadow"
                            style={{ borderLeftWidth: 3, borderLeftColor: color }}
                          >
                            <div className="font-medium text-sm text-even-navy truncate">{a.patient_name}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{a.uhid} &middot; IP: {a.ip_number}</div>
                            {a.surgery_name && (
                              <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                <Stethoscope size={10} /> {a.surgery_name}
                              </div>
                            )}
                            {a.room_number && (
                              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                                <BedDouble size={10} /> Room {a.room_number}{a.bed_number ? ` / Bed ${a.bed_number}` : ''}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {/* Surgery readiness badge */}
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{
                                  backgroundColor: statusBg(SURGERY_READINESS_COLORS[a.surgery_readiness]),
                                  color: SURGERY_READINESS_COLORS[a.surgery_readiness],
                                }}
                              >
                                {SURGERY_READINESS_LABELS[a.surgery_readiness]}
                              </span>
                              {/* Financial badge */}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                a.financial_category === 'insurance' ? 'bg-blue-50 text-blue-600' :
                                a.financial_category === 'cash' ? 'bg-green-50 text-green-600' :
                                'bg-amber-50 text-amber-600'
                              }`}>
                                {a.financial_category}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── SURGERY SCHEDULE VIEW ── */}
          {tab === 'surgery' && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {surgerySchedule.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <CalendarClock size={32} className="mx-auto mb-2 text-gray-300" />
                  No surgeries scheduled
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Surgery</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Surgeon</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Planned Date</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Readiness</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {surgerySchedule.map(a => {
                        const isToday = a.planned_surgery_date &&
                          new Date(a.planned_surgery_date).toDateString() === new Date().toDateString();
                        const isPast = a.planned_surgery_date &&
                          new Date(a.planned_surgery_date) < new Date() && !isToday;
                        return (
                          <tr key={a.id} className={`hover:bg-gray-50 ${isPast ? 'bg-red-50/30' : isToday ? 'bg-amber-50/30' : ''}`}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-even-navy">{a.patient_name}</div>
                              <div className="text-xs text-gray-400">{a.uhid} &middot; Room {a.room_number || '—'}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-700">{a.surgery_name || '—'}</td>
                            <td className="px-4 py-3 text-gray-600">{a.primary_surgeon || '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`text-sm ${isToday ? 'font-bold text-amber-600' : isPast ? 'text-red-500' : 'text-gray-700'}`}>
                                {formatDateTime(a.planned_surgery_date)}
                              </span>
                              {isToday && <span className="ml-1 text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">TODAY</span>}
                              {isPast && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">OVERDUE</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  backgroundColor: statusBg(SURGERY_READINESS_COLORS[a.surgery_readiness]),
                                  color: SURGERY_READINESS_COLORS[a.surgery_readiness],
                                }}
                              >
                                {SURGERY_READINESS_LABELS[a.surgery_readiness]}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  backgroundColor: statusBg(PATIENT_STATUS_COLORS[a.current_status]),
                                  color: PATIENT_STATUS_COLORS[a.current_status],
                                }}
                              >
                                {PATIENT_STATUS_LABELS[a.current_status]}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── DISCHARGE READINESS VIEW ── */}
          {tab === 'discharge' && (
            <div className="space-y-3">
              {dischargeList.map(a => {
                const pct = a.readiness_pct;
                const barColor = pct >= 80 ? '#22C55E' : pct >= 50 ? '#F97316' : '#EF4444';
                return (
                  <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-even-navy">{a.patient_name}</span>
                          <span className="text-xs text-gray-400">{a.uhid}</span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: statusBg(PATIENT_STATUS_COLORS[a.current_status]),
                              color: PATIENT_STATUS_COLORS[a.current_status],
                            }}
                          >
                            {PATIENT_STATUS_LABELS[a.current_status]}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          Admitted {formatDate(a.admission_date)}
                          {a.surgery_name ? ` &middot; ${a.surgery_name}` : ''}
                        </div>

                        {/* Readiness progress bar */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5 max-w-xs">
                            <div
                              className="h-2.5 rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <span className="text-sm font-bold" style={{ color: barColor }}>
                            {pct}%
                          </span>
                          <span className="text-xs text-gray-400">
                            {a.readiness_score}/{a.readiness_total} items
                          </span>
                        </div>

                        {/* Checklist items */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          <CheckItem done={a.financial_counselling_complete} label="Financial Counselling" />
                          <CheckItem done={a.deposit_status === 'collected' || a.deposit_status === 'waived'} label={`Deposit (${a.deposit_status})`} />
                          <CheckItem done={a.pre_auth_status === 'approved' || a.pre_auth_status === 'not_required'} label={`Pre-Auth (${a.pre_auth_status?.replace(/_/g, ' ')})`} />
                          <CheckItem done={a.ot_clearance_complete} label="OT Clearance" />
                          <CheckItem done={a.pac_complete} label="PAC" />
                          {a.physician_clearance_required && (
                            <CheckItem done={a.physician_clearance_done} label="Physician" />
                          )}
                          {a.cardiologist_clearance_required && (
                            <CheckItem done={a.cardiologist_clearance_done} label="Cardiology" />
                          )}
                        </div>
                      </div>

                      {/* Financial quick info */}
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 text-xs text-gray-500 justify-end">
                          <CreditCard size={10} />
                          <span className="capitalize">{a.financial_category}</span>
                        </div>
                        {a.estimated_cost && (
                          <div className="text-sm font-semibold text-even-navy mt-0.5">
                            ₹{a.estimated_cost.toLocaleString('en-IN')}
                          </div>
                        )}
                        {a.tpa_name && (
                          <div className="text-xs text-gray-400 mt-0.5">{a.tpa_name}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-even-navy">New Admission</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Patient Info */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name *</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Full name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">UHID *</label>
                  <input type="text" value={fUhid} onChange={e => setFUhid(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="KX-2026-001" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">IP Number *</label>
                  <input type="text" value={fIpNumber} onChange={e => setFIpNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="IP-001" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admission Date *</label>
                <input type="datetime-local" value={fAdmDate} onChange={e => setFAdmDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>

              {/* Clinical */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Clinical</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Primary Surgeon</label>
                    <input type="text" value={fSurgeon} onChange={e => setFSurgeon(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Dr. ..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Surgery Name</label>
                    <input type="text" value={fSurgeryName} onChange={e => setFSurgeryName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Appendectomy" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Planned Surgery Date</label>
                  <input type="datetime-local" value={fSurgeryDate} onChange={e => setFSurgeryDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>

              {/* Room & Financial */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Room & Financial</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
                    <input type="text" value={fRoom} onChange={e => setFRoom(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="301" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Room Type</label>
                    <select value={fRoomCat} onChange={e => setFRoomCat(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                      <option value="general">General</option>
                      <option value="semi_private">Semi Private</option>
                      <option value="private">Private</option>
                      <option value="suite">Suite</option>
                      <option value="icu">ICU</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment</label>
                    <select value={fFinCat} onChange={e => setFFinCat(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                      <option value="insurance">Insurance</option>
                      <option value="cash">Cash</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Package</label>
                    <input type="text" value={fPackage} onChange={e => setFPackage(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Appendectomy Package" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Est. Cost (₹)</label>
                    <input type="number" value={fEstCost} onChange={e => setFEstCost(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="150000" />
                  </div>
                </div>
                {fFinCat === 'insurance' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">TPA Name</label>
                    <input type="text" value={fTpa} onChange={e => setFTpa(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Medi Assist" />
                  </div>
                )}
              </div>

              {/* Coordinator */}
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">IP Coordinator</label>
                <select value={fCoordinator} onChange={e => setFCoordinator(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  <option value="">Select...</option>
                  {staffList.filter(s => s.role === 'ip_coordinator').map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              </div>

              {msg && showCreate && (
                <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                  msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  {msg.text}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={saving}
                className="px-4 py-2 text-sm bg-even-blue text-white rounded-lg hover:bg-even-navy disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Admission'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminLayout>
  );
}

// ── Readiness check item component ──
function CheckItem({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
      done ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'
    }`}>
      {done ? <CheckCircle size={10} /> : <Clock size={10} />}
      {label}
    </span>
  );
}
