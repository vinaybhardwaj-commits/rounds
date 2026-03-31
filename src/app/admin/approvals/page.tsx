'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp, Save, AlertCircle } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

interface Department {
  id: string;
  name: string;
}

interface PendingUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  designation: string;
  phone: string;
  department_id: string | null;
  department_name: string | null;
  created_at: string;
}

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'department_head', label: 'Department Head' },
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
];

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Editable fields for the expanded card
  const [editData, setEditData] = useState<{
    full_name: string;
    role: string;
    department_id: string;
    designation: string;
    phone: string;
  }>({ full_name: '', role: 'staff', department_id: '', designation: '', phone: '' });

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const [approvalRes, deptRes] = await Promise.all([
        fetch('/api/admin/approvals'),
        fetch('/api/departments'),
      ]);
      const approvalData = await approvalRes.json();
      const deptData = await deptRes.json();
      if (approvalData.success) setPending(approvalData.data);
      if (deptData.success) setDepartments(deptData.data || []);
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // Show toast and auto-dismiss
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const toggleExpand = (user: PendingUser) => {
    if (expandedId === user.id) {
      setExpandedId(null);
    } else {
      setExpandedId(user.id);
      setEditData({
        full_name: user.full_name,
        role: user.role,
        department_id: user.department_id || '',
        designation: user.designation || '',
        phone: user.phone || '',
      });
    }
  };

  const handleAction = async (profileId: string, action: 'approve' | 'reject') => {
    setActionLoading(profileId);
    try {
      // If approving, include any edits
      const body: Record<string, unknown> = { profileId, action };
      if (action === 'approve' && expandedId === profileId) {
        body.updates = {
          full_name: editData.full_name,
          role: editData.role,
          department_id: editData.department_id || null,
          designation: editData.designation || null,
          phone: editData.phone || null,
        };
      }

      const res = await fetch('/api/admin/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setPending(prev => prev.filter(p => p.id !== profileId));
        setExpandedId(null);
        showToast('success', `${data.data.full_name} ${action === 'approve' ? 'approved' : 'rejected'}`);
      } else {
        showToast('error', data.error || 'Action failed');
      }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Network error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatRole = (role: string) =>
    role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Pending Approvals' }]}>
      <div className="p-6">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {toast.message}
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-even-navy">Pending Approvals</h1>
            <p className="text-gray-500 text-sm mt-1">Review and approve new staff registrations</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchPending}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <a
              href="/admin/users"
              className="flex items-center gap-2 px-3 py-2 text-sm bg-even-navy text-white rounded-lg hover:bg-opacity-90 transition-colors"
            >
              All Users
            </a>
          </div>
        </div>

        {/* Shareable signup link */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800 font-medium mb-1">Staff signup link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-blue-200 rounded-lg px-3 py-2 text-blue-700 select-all">
              https://rounds-sqxh.vercel.app/signup
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText('https://rounds-sqxh.vercel.app/signup');
                showToast('success', 'Link copied!');
              }}
              className="px-3 py-2 text-xs font-medium bg-even-blue text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-1.5">Share this link with new staff members. Signups appear here for approval.</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : pending.length === 0 ? (
          <div className="text-center py-12">
            <Clock size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No pending approvals</p>
            <p className="text-gray-400 text-sm mt-1">New signups will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map(user => {
              const isExpanded = expandedId === user.id;
              const isLoading = actionLoading === user.id;

              return (
                <div
                  key={user.id}
                  className={`bg-white border rounded-xl overflow-hidden transition-all ${
                    isExpanded ? 'border-even-blue shadow-md' : 'border-gray-200'
                  }`}
                >
                  {/* Collapsed header — always visible */}
                  <div
                    onClick={() => toggleExpand(user)}
                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-even-navy truncate">{user.full_name}</h3>
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">
                          Pending
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full shrink-0">
                          {formatRole(user.role)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{user.email}</p>
                      <div className="flex gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                        {user.designation && <span>{user.designation}</span>}
                        {user.department_name && <span>| {user.department_name}</span>}
                        {user.phone && <span>| {user.phone}</span>}
                        <span>| Signed up {new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Quick approve/reject (when collapsed) */}
                      {!isExpanded && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); handleAction(user.id, 'approve'); }}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle size={14} /> Approve
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleAction(user.id, 'reject'); }}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                          >
                            <XCircle size={14} /> Reject
                          </button>
                        </>
                      )}
                      {isExpanded ? (
                        <ChevronUp size={18} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={18} className="text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded edit section */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 bg-gray-50/50 space-y-4">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Edit before approving
                      </p>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Full Name */}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                          <input
                            type="text"
                            value={editData.full_name}
                            onChange={e => setEditData({ ...editData, full_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none bg-white"
                          />
                        </div>

                        {/* Role */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                          <select
                            value={editData.role}
                            onChange={e => setEditData({ ...editData, role: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none bg-white"
                          >
                            {ROLE_OPTIONS.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Department */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                          <select
                            value={editData.department_id}
                            onChange={e => setEditData({ ...editData, department_id: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none bg-white"
                          >
                            <option value="">— No department —</option>
                            {departments.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* Designation */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Designation</label>
                          <input
                            type="text"
                            value={editData.designation}
                            onChange={e => setEditData({ ...editData, designation: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none bg-white"
                          />
                        </div>

                        {/* Phone */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                          <input
                            type="tel"
                            value={editData.phone}
                            onChange={e => setEditData({ ...editData, phone: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none bg-white"
                          />
                        </div>
                      </div>

                      {/* Email (read-only) */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Email (cannot be changed)</label>
                        <p className="text-sm text-gray-600 px-3 py-2 bg-gray-100 rounded-lg">{user.email}</p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => handleAction(user.id, 'approve')}
                          disabled={isLoading || !editData.full_name}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isLoading ? (
                            <Save size={16} className="animate-spin" />
                          ) : (
                            <CheckCircle size={16} />
                          )}
                          {isLoading ? 'Processing...' : 'Save & Approve'}
                        </button>
                        <button
                          onClick={() => handleAction(user.id, 'reject')}
                          disabled={isLoading}
                          className="px-6 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <XCircle size={16} /> Reject
                        </button>
                        <button
                          onClick={() => setExpandedId(null)}
                          className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
