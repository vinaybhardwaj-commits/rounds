'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Plus,
  Trash2,
  RefreshCw,
  Clock,
  Sun,
  Moon,
  Phone,
  Briefcase,
  X,
  AlertCircle,
  CheckCircle,
  Bell,
} from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import type { DutyRosterEntry, ShiftType } from '@/types';
import { SHIFT_TYPE_LABELS, DAY_LABELS } from '@/types';

// ── Shift badge colors ──
const SHIFT_COLORS: Record<ShiftType, { bg: string; text: string; icon: React.ReactNode }> = {
  day:      { bg: 'bg-amber-100',  text: 'text-amber-700',  icon: <Sun size={12} /> },
  evening:  { bg: 'bg-orange-100', text: 'text-orange-700', icon: <Clock size={12} /> },
  night:    { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: <Moon size={12} /> },
  on_call:  { bg: 'bg-red-100',    text: 'text-red-700',    icon: <Phone size={12} /> },
  visiting: { bg: 'bg-teal-100',   text: 'text-teal-700',   icon: <Briefcase size={12} /> },
};

interface StaffOption { id: string; full_name: string; role: string; department_name: string | null; }
interface DeptOption  { id: string; name: string; }

const ROLE_OPTIONS = [
  'nurse', 'anesthesiologist', 'ot_coordinator', 'billing_executive',
  'insurance_coordinator', 'pharmacist', 'physiotherapist', 'ip_coordinator',
  'marketing_executive', 'clinical_care', 'pac_coordinator', 'department_head', 'staff',
];

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun display order

export default function DutyRosterPage() {
  // ── List state ──
  const [entries, setEntries] = useState<DutyRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  // ── Create modal state ──
  const [showCreate, setShowCreate] = useState(false);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [deptList, setDeptList] = useState<DeptOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Form fields ──
  const [formUserId, setFormUserId] = useState('');
  const [formDeptId, setFormDeptId] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formShiftType, setFormShiftType] = useState<ShiftType>('day');
  const [formDays, setFormDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
  const [formStartTime, setFormStartTime] = useState('08:00');
  const [formEndTime, setFormEndTime] = useState('20:00');
  const [formEffFrom, setFormEffFrom] = useState(new Date().toISOString().slice(0, 10));
  const [formEffTo, setFormEffTo] = useState('');
  const [formIsOverride, setFormIsOverride] = useState(false);
  const [formOverrideReason, setFormOverrideReason] = useState('');
  const [formOverrideDate, setFormOverrideDate] = useState('');

  // ── Fetch entries ──
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (deptFilter) params.set('department_id', deptFilter);
      if (roleFilter) params.set('role', roleFilter);
      if (activeOnly) params.set('active_only', 'true');

      const res = await fetch(`/api/duty-roster?${params.toString()}`);
      const data = await res.json();
      if (data.success) setEntries(data.data || []);
    } catch (err) {
      console.error('Failed to fetch duty roster:', err);
    } finally {
      setLoading(false);
    }
  }, [deptFilter, roleFilter, activeOnly]);

  // ── Fetch staff + departments for create form ──
  const fetchLookups = useCallback(async () => {
    try {
      const [staffRes, deptRes] = await Promise.all([
        fetch('/api/profiles?status=active&limit=500'),
        fetch('/api/departments'),
      ]);
      const staffData = await staffRes.json();
      const deptData = await deptRes.json();
      if (staffData.success) setStaffList(staffData.data || []);
      if (deptData.success) setDeptList(deptData.data || []);
    } catch (err) {
      console.error('Failed to fetch lookups:', err);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchLookups(); }, [fetchLookups]);

  // ── Day toggle ──
  const toggleDay = (day: number) => {
    setFormDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  // ── Create entry ──
  const handleCreate = async () => {
    setSaveMsg(null);

    if (!formUserId || !formDeptId || !formRole || !formShiftType || formDays.length === 0 || !formEffFrom) {
      setSaveMsg({ type: 'error', text: 'Please fill all required fields.' });
      return;
    }

    if (formIsOverride && !formOverrideDate) {
      setSaveMsg({ type: 'error', text: 'Override entries require a specific date.' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/duty-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: formUserId,
          department_id: formDeptId,
          role: formRole,
          shift_type: formShiftType,
          day_of_week: formDays,
          shift_start_time: formStartTime || null,
          shift_end_time: formEndTime || null,
          effective_from: formEffFrom,
          effective_to: formEffTo || null,
          is_override: formIsOverride,
          override_reason: formIsOverride ? formOverrideReason : null,
          override_date: formIsOverride ? formOverrideDate : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg({ type: 'success', text: 'Duty roster entry created.' });
        setShowCreate(false);
        resetForm();
        fetchEntries();
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Failed to create entry.' });
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Network error. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete entry ──
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this duty roster entry?')) return;
    try {
      const res = await fetch(`/api/duty-roster/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) fetchEntries();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // ── Send handoff notification ──
  const handleNotify = async (id: string, userName: string) => {
    if (!confirm(`Send shift handoff notification for ${userName} to their department channel?`)) return;
    try {
      const res = await fetch('/api/duty-roster/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster_entry_id: id }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg({ type: 'success', text: `Handoff notification sent for ${userName}` });
      } else {
        setSaveMsg({ type: 'error', text: data.error || 'Failed to send notification' });
      }
    } catch {
      setSaveMsg({ type: 'error', text: 'Network error sending notification' });
    }
  };

  const resetForm = () => {
    setFormUserId('');
    setFormDeptId('');
    setFormRole('');
    setFormShiftType('day');
    setFormDays([1, 2, 3, 4, 5]);
    setFormStartTime('08:00');
    setFormEndTime('20:00');
    setFormEffFrom(new Date().toISOString().slice(0, 10));
    setFormEffTo('');
    setFormIsOverride(false);
    setFormOverrideReason('');
    setFormOverrideDate('');
    setSaveMsg(null);
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'Duty Roster'}]}>
      <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy flex items-center gap-2">
            <Calendar size={24} /> Duty Roster
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {entries.length} {activeOnly ? 'active' : 'total'} roster entries
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors"
          >
            <Plus size={16} /> Add Entry
          </button>
          <button
            onClick={fetchEntries}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Departments</option>
          {deptList.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All Roles</option>
          {ROLE_OPTIONS.map(r => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Active only
        </label>
      </div>

      {/* Success/Error toast */}
      {saveMsg && !showCreate && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          saveMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {saveMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {saveMsg.text}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
          <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No duty roster entries</p>
          <p className="text-gray-400 text-sm mt-1">
            Click &ldquo;Add Entry&rdquo; to assign staff to shifts.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Staff</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Shift</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Days</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Effective</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(entry => {
                  const shiftStyle = SHIFT_COLORS[entry.shift_type] || SHIFT_COLORS.day;
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-even-navy">{entry.user_name || '—'}</div>
                        {entry.is_override && (
                          <span className="text-xs text-red-500 font-medium">Override</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{entry.department_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {entry.role.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${shiftStyle.bg} ${shiftStyle.text}`}>
                          {shiftStyle.icon} {SHIFT_TYPE_LABELS[entry.shift_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.is_override && entry.override_date ? (
                          <span className="text-xs text-red-600">{formatDate(entry.override_date)}</span>
                        ) : (
                          <div className="flex gap-0.5">
                            {ALL_DAYS.map(d => (
                              <span
                                key={d}
                                className={`w-6 h-6 flex items-center justify-center rounded text-xs font-medium ${
                                  entry.day_of_week?.includes(d)
                                    ? 'bg-even-blue text-white'
                                    : 'bg-gray-100 text-gray-300'
                                }`}
                              >
                                {DAY_LABELS[d]?.[0]}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {entry.shift_start_time && entry.shift_end_time
                          ? `${entry.shift_start_time} – ${entry.shift_end_time}`
                          : entry.shift_start_time || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        <div>{formatDate(entry.effective_from)}</div>
                        {entry.effective_to && (
                          <div className="text-gray-400">to {formatDate(entry.effective_to)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleNotify(entry.id, entry.user_name || 'Unknown')}
                            className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                            title="Send handoff notification to department channel"
                          >
                            <Bell size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Delete entry"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-even-navy">New Duty Roster Entry</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Staff */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
                <select
                  value={formUserId}
                  onChange={e => setFormUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">Select staff...</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.role.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
                <select
                  value={formDeptId}
                  onChange={e => setFormDeptId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">Select department...</option>
                  {deptList.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">Select role...</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Shift Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift Type *</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(SHIFT_TYPE_LABELS) as [ShiftType, string][]).map(([key, label]) => {
                    const style = SHIFT_COLORS[key];
                    const selected = formShiftType === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setFormShiftType(key)}
                        className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          selected
                            ? `${style.bg} ${style.text} border-current font-medium`
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {style.icon} {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Days of Week *</label>
                <div className="flex gap-1.5">
                  {ALL_DAYS.map(d => (
                    <button
                      key={d}
                      onClick={() => toggleDay(d)}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                        formDays.includes(d)
                          ? 'bg-even-blue text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {DAY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shift Times */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={e => setFormStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={formEndTime}
                    onChange={e => setFormEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Effective Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From *</label>
                  <input
                    type="date"
                    value={formEffFrom}
                    onChange={e => setFormEffFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective To</label>
                  <input
                    type="date"
                    value={formEffTo}
                    onChange={e => setFormEffTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    placeholder="Ongoing if empty"
                  />
                </div>
              </div>

              {/* Override Toggle */}
              <div className="border-t border-gray-100 pt-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIsOverride}
                    onChange={e => setFormIsOverride(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  This is a temporary override (e.g., swapping duty for one day)
                </label>
              </div>

              {formIsOverride && (
                <div className="space-y-3 pl-4 border-l-2 border-red-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Override Date *</label>
                    <input
                      type="date"
                      value={formOverrideDate}
                      onChange={e => setFormOverrideDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <input
                      type="text"
                      value={formOverrideReason}
                      onChange={e => setFormOverrideReason(e.target.value)}
                      placeholder="e.g., Dr. Kumar covering for Dr. Sharma"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Error/Success */}
              {saveMsg && (
                <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                  saveMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {saveMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  {saveMsg.text}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm bg-even-blue text-white rounded-lg hover:bg-even-navy transition-colors disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminLayout>
  );
}
