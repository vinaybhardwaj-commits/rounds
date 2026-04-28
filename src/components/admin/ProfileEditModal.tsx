'use client';

import { useState, useEffect, useCallback } from 'react';
import { HospitalPicker } from '@/components/HospitalPicker';
import { HospitalChip } from '@/components/HospitalChip';
import { X, Save, Key, Loader2, AlertCircle, CheckCircle, ShieldAlert, Trash2, Ban } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  slug: string;
}

interface ProfileData {
  id: string;
  email: string;
  full_name: string;
  display_name: string | null;
  role: string;
  status: string;
  designation: string | null;
  phone: string | null;
  department_id: string | null;
  department_name: string | null;
  account_type: string;
  has_pin: boolean;
  created_at: string;
  last_login_at: string | null;
  // MH.7c — multi-hospital tenancy fields surfaced by GET /api/admin/profiles/[id]
  primary_hospital_id: string | null;
  primary_hospital_slug: string | null;
  primary_hospital_short_name: string | null;
  primary_hospital_name: string | null;
  role_scope: string | null;
}

interface Props {
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
  currentUserRole?: string;
  currentUserId?: string;
}

const ROLES = [
  { value: 'staff', label: 'Staff' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'department_head', label: 'Department Head' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'ip_coordinator', label: 'IP Coordinator' },
  { value: 'anesthesiologist', label: 'Anesthesiologist' },
  { value: 'ot_coordinator', label: 'OT Coordinator' },
  { value: 'billing_executive', label: 'Billing Executive' },
  { value: 'insurance_coordinator', label: 'Insurance Coordinator' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'physiotherapist', label: 'Physiotherapist' },
  { value: 'marketing_executive', label: 'Marketing Executive' },
  { value: 'clinical_care', label: 'Clinical Care' },
  { value: 'pac_coordinator', label: 'PAC Coordinator' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'medical_administrator', label: 'Medical Administrator' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'unit_head', label: 'Unit Head' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'guest', label: 'Guest' },
];

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Rejected' },
];

export function ProfileEditModal({ profileId, onClose, onSaved, currentUserRole, currentUserId }: Props) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [status, setStatus] = useState('active');
  const [departmentId, setDepartmentId] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  // MH.7c — multi-hospital tenancy editable fields
  const [primaryHospitalId, setPrimaryHospitalId] = useState<string | null>(null);
  const [roleScope, setRoleScope] = useState<string>('hospital_bound');
  // MH.7d — additional hospital grants (only relevant for multi_hospital scope)
  const [grants, setGrants] = useState<Array<{
    id: string;
    hospital_id: string;
    hospital_slug: string;
    hospital_short_name: string | null;
    hospital_name: string;
  }>>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [addGrantHospitalId, setAddGrantHospitalId] = useState<string | null>(null);
  const [addGrantSubmitting, setAddGrantSubmitting] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [showPinReset, setShowPinReset] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, deptRes] = await Promise.all([
        fetch(`/api/admin/profiles/${profileId}`),
        fetch('/api/departments'),
      ]);
      const profileData = await profileRes.json();
      const deptData = await deptRes.json();

      if (profileData.success) {
        const p = profileData.data as ProfileData;
        setProfile(p);
        setFullName(p.full_name);
        setEmail(p.email);
        setRole(p.role);
        setStatus(p.status);
        setDepartmentId(p.department_id || '');
        setDesignation(p.designation || '');
        setPhone(p.phone || '');
        setPrimaryHospitalId(p.primary_hospital_id || null);
        setRoleScope(p.role_scope || 'hospital_bound');
      } else {
        setError('Failed to load profile');
      }

      if (deptData.success) {
        setDepartments(deptData.data);
      }
    } catch {
      setError('Network error loading profile');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // MH.7d — fetch additional hospital grants (separately from profile fetch).
  const fetchGrants = useCallback(async () => {
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/hospital-access`);
      const data = await res.json();
      if (data.success) {
        setGrants(data.data || []);
      } else {
        setGrantsError(data.error || 'Failed to load grants');
      }
    } catch (e) {
      setGrantsError(e instanceof Error ? e.message : 'Failed to load grants');
    } finally {
      setGrantsLoading(false);
    }
  }, [profileId]);
  useEffect(() => { fetchGrants(); }, [fetchGrants]);

  const handleAddGrant = async () => {
    if (!addGrantHospitalId) return;
    setAddGrantSubmitting(true);
    setGrantsError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/hospital-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospital_id: addGrantHospitalId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setAddGrantHospitalId(null);
      await fetchGrants();
    } catch (e) {
      setGrantsError(e instanceof Error ? e.message : 'Failed to add grant');
    } finally {
      setAddGrantSubmitting(false);
    }
  };

  const handleRemoveGrant = async (grantId: string) => {
    if (!confirm('Revoke this hospital access?')) return;
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/hospital-access/${grantId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await fetchGrants();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke grant');
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const body: Record<string, string | null> = {
      full_name: fullName,
      email,
      role,
      status,
      department_id: departmentId || null,
      designation: designation || null,
      phone: phone || null,
      // MH.7c — multi-hospital tenancy fields (validated server-side)
      primary_hospital_id: primaryHospitalId,
      role_scope: roleScope,
    };

    if (showPinReset && newPin) {
      (body as Record<string, string | null>).new_pin = newPin;
    }

    try {
      const res = await fetch(`/api/admin/profiles/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setSuccess('Profile updated successfully');
        setNewPin('');
        setShowPinReset(false);
        setTimeout(() => {
          onSaved();
          onClose();
        }, 800);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickSuspend = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('User suspended');
        setTimeout(() => { onSaved(); onClose(); }, 800);
      } else {
        setError(data.error || 'Failed to suspend');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSuccess('User permanently deleted');
        setShowDeleteConfirm(false);
        setTimeout(() => { onSaved(); onClose(); }, 1000);
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch {
      setError('Network error');
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = currentUserRole === 'super_admin' && profileId !== currentUserId;
  const canSuspend = profile?.status === 'active';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-lg font-bold text-even-navy">Edit Profile</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-even-blue" />
          </div>
        ) : !profile ? (
          <div className="px-6 py-12 text-center text-red-500">Profile not found</div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              />
            </div>

            {/* Role + Status row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                >
                  {STATUSES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Department */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
              <select
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
              >
                <option value="">— No department —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* MH.7c — Primary Hospital + Scope (multi-hospital tenancy controls) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <HospitalPicker
                  value={primaryHospitalId}
                  onChange={setPrimaryHospitalId}
                  label="Primary Hospital"
                  required
                  name="primary_hospital_id"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Scope <span className="text-red-500">*</span>
                </label>
                <select
                  value={roleScope}
                  onChange={e => setRoleScope(e.target.value)}
                  className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-even-blue outline-none"
                >
                  <option value="hospital_bound">Hospital-bound (only sees primary)</option>
                  <option value="multi_hospital">Multi-hospital (visiting consultants)</option>
                  <option value="central">Central (all hospitals — leadership)</option>
                </select>
                <p className="text-[10px] text-gray-400 mt-1">
                  Controls how much cross-hospital data this user can see.
                </p>
              </div>
            </div>

            {/* MH.7d — Additional Hospitals (only when scope = multi_hospital).
                Hospital-bound users only see their primary; central users see all
                automatically. Only multi_hospital users need explicit grants. */}
            {roleScope === 'multi_hospital' && (
              <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-semibold text-purple-900">
                      Additional Hospitals
                    </div>
                    <div className="text-[10px] text-purple-700">
                      Beyond the primary above. This user gets access to data at any hospital listed here.
                    </div>
                  </div>
                </div>
                {grantsError && (
                  <div className="mb-2 rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700">
                    {grantsError}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {grantsLoading ? (
                    <span className="text-[11px] text-gray-400">Loading…</span>
                  ) : grants.length === 0 ? (
                    <span className="text-[11px] text-gray-500 italic">No additional grants yet.</span>
                  ) : (
                    grants.map((g) => (
                      <div key={g.id} className="flex items-center gap-0.5 group">
                        <HospitalChip
                          hospitalSlug={g.hospital_slug}
                          hospitalShortName={g.hospital_short_name}
                          hospitalName={g.hospital_name}
                        />
                        <button
                          onClick={() => handleRemoveGrant(g.id)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500"
                          aria-label={`Revoke ${g.hospital_slug.toUpperCase()} access`}
                          type="button"
                        >
                          <span className="text-xs">✕</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <HospitalPicker
                      value={addGrantHospitalId}
                      onChange={setAddGrantHospitalId}
                      label="Grant access to…"
                      required={false}
                      name="add_grant_hospital_id"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddGrant}
                    disabled={!addGrantHospitalId || addGrantSubmitting}
                    className="h-9 px-3 text-xs bg-even-blue text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {addGrantSubmitting ? 'Adding…' : '+ Grant'}
                  </button>
                </div>
              </div>
            )}

            {/* Designation */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Designation / Job Title</label>
              <input
                type="text"
                value={designation}
                onChange={e => setDesignation(e.target.value)}
                placeholder="e.g. Senior Nurse, HOD — ICU"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              />
            </div>

            {/* PIN Reset section */}
            <div className="border-t border-gray-100 pt-4">
              {!showPinReset ? (
                <button
                  onClick={() => setShowPinReset(true)}
                  className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
                >
                  <Key size={14} />
                  {profile.has_pin ? 'Reset PIN' : 'Set PIN'}
                </button>
              ) : (
                <div className="bg-amber-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                      <Key size={12} /> New 4-digit PIN
                    </label>
                    <button
                      onClick={() => { setShowPinReset(false); setNewPin(''); }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newPin}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setNewPin(val);
                    }}
                    placeholder="Enter 4-digit PIN"
                    maxLength={4}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm text-center tracking-[0.5em] font-mono focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                  />
                  {newPin.length > 0 && newPin.length < 4 && (
                    <p className="text-xs text-amber-600 mt-1">{4 - newPin.length} more digit{4 - newPin.length > 1 ? 's' : ''} needed</p>
                  )}
                  {newPin.length === 4 && (
                    <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                      <ShieldAlert size={11} /> User will be required to change this PIN on next login.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Meta info */}
            <div className="border-t border-gray-100 pt-3 text-xs text-gray-400 space-y-0.5">
              <p>Created: {new Date(profile.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              <p>Last login: {profile.last_login_at ? new Date(profile.last_login_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}</p>
              <p className="font-mono text-[10px] text-gray-300 select-all">{profile.id}</p>
            </div>

            {/* ── Danger Zone ── */}
            {(canSuspend || canDelete) && (
              <div className="border-t border-red-100 pt-4">
                <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold mb-2">Danger Zone</p>
                <div className="flex gap-2">
                  {canSuspend && (
                    <button
                      onClick={handleQuickSuspend}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      <Ban size={12} /> Suspend User
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={12} /> Delete User
                    </button>
                  )}
                </div>
                {canDelete && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    Deletion is permanent. All actions and history by this user will be preserved.
                  </p>
                )}
              </div>
            )}

            {/* Delete Confirmation */}
            {showDeleteConfirm && profile && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800 mb-1">Permanently delete {profile.full_name}?</p>
                <p className="text-xs text-red-600 mb-3">
                  This will remove their login access and profile. Their form submissions, chat messages, and all actions will be preserved in the system.
                </p>
                <label className="block text-xs text-red-700 mb-1">
                  Type <strong>DELETE</strong> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm font-mono tracking-wider text-center focus:ring-2 focus:ring-red-400 outline-none bg-white mb-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                    className="flex-1 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteConfirmText !== 'DELETE' || deleting}
                    className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {deleting ? 'Deleting...' : 'Permanently Delete'}
                  </button>
                </div>
              </div>
            )}

            {/* Error / Success */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                <CheckCircle size={14} /> {success}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {!loading && profile && (
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex gap-3 rounded-b-2xl">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !fullName || !email}
              className="flex-1 py-2.5 bg-even-blue text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
