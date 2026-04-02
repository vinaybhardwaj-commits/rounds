'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Check,
  Flag,
  UserPlus,
  X,
  ChevronRight,
  ChevronDown,
  Search,
  Loader2,
  Undo2,
} from 'lucide-react';

// ----- Types -----

interface ReadinessItem {
  id: string;
  item_name: string;
  item_category: string;
  responsible_role: string;
  responsible_user_id: string | null;
  status: string;
  due_by: string | null;
  escalated: boolean;
  escalation_level: number;
  form_type: string;
  patient_name: string | null;
  patient_thread_id: string | null;
  flagged_reason?: string | null;
}

interface CompletedItem {
  id: string;
  item_name: string;
  item_category: string;
  responsible_role: string;
  responsible_user_id: string | null;
  status: string;
  due_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  form_type: string;
  patient_name: string | null;
  patient_thread_id: string | null;
}

interface EscalationEntry {
  id: string;
  reason: string;
  level: number;
  resolved: boolean;
  patient_name: string | null;
  source_type: string;
  created_at: string;
}

interface StaffProfile {
  id: string;
  full_name: string;
  role: string;
  department_name?: string;
}

import { DailyBriefing } from '@/components/ai/DailyBriefing';
import { OTItemsTab } from '@/components/ot/OTItemsTab';
import { OTSchedulePage } from '@/components/ot/OTSchedulePage';

type TaskTab = 'briefing' | 'overdue' | 'escalations' | 'ot_items';

interface TasksViewProps {
  onNavigateToPatient?: (patientThreadId: string) => void;
  userRole?: string;
  userId?: string;
}

export function TasksView({ onNavigateToPatient, userRole = '', userId = '' }: TasksViewProps) {
  const [tab, setTab] = useState<TaskTab>('briefing');
  const [overdueItems, setOverdueItems] = useState<ReadinessItem[]>([]);
  const [completedItems, setCompletedItems] = useState<CompletedItem[]>([]);
  const [escalations, setEscalations] = useState<EscalationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [flagTarget, setFlagTarget] = useState<ReadinessItem | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [assignTarget, setAssignTarget] = useState<ReadinessItem | null>(null);
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffLoading, setStaffLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ReadinessItem | null>(null);

  // Feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [assignedNames, setAssignedNames] = useState<Record<string, string>>({});
  const [showOTSchedule, setShowOTSchedule] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overdueRes, completedRes, escRes] = await Promise.all([
        fetch('/api/readiness/overdue'),
        fetch('/api/readiness/completed'),
        fetch('/api/escalation/log?resolved=false'),
      ]);

      if (overdueRes.ok) {
        const overdueData = await overdueRes.json();
        if (overdueData.success) setOverdueItems(overdueData.data || []);
      }

      if (completedRes.ok) {
        const completedData = await completedRes.json();
        if (completedData.success) setCompletedItems(completedData.data || []);
      }

      const escData = await escRes.json();
      if (escData.success) setEscalations(escData.data || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-dismiss toast after 3s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ----- Helpers -----

  const formatTimeAgo = (d: string) => {
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  const formatOverdue = (dueBy: string | null) => {
    if (!dueBy) return '';
    const overdueMins = Math.round((Date.now() - new Date(dueBy).getTime()) / 60000);
    if (overdueMins >= 1440) return `${Math.round(overdueMins / 1440)}d ${Math.round((overdueMins % 1440) / 60)}h overdue`;
    if (overdueMins >= 60) return `${Math.round(overdueMins / 60)}h ${overdueMins % 60}m overdue`;
    return `${overdueMins}m overdue`;
  };

  const formatDateTime = (d: string | null) => {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  // ----- Actions -----

  const handleConfirm = async (item: ReadinessItem) => {
    setActionLoading(item.id);
    try {
      const res = await fetch(`/api/readiness/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      const data = await res.json();
      if (data.success) {
        // Move from active to completed list (don't delete!)
        setOverdueItems(prev => prev.filter(i => i.id !== item.id));
        const returned = data.data;
        setCompletedItems(prev => [{
          id: returned.id,
          item_name: returned.item_name,
          item_category: returned.item_category,
          responsible_role: returned.responsible_role,
          responsible_user_id: returned.responsible_user_id,
          status: 'confirmed',
          due_by: returned.due_by,
          confirmed_by: returned.confirmed_by,
          confirmed_at: returned.confirmed_at,
          confirmed_by_name: null, // will appear on refresh; for now show 'You'
          form_type: item.form_type,
          patient_name: item.patient_name,
          patient_thread_id: item.patient_thread_id,
        }, ...prev]);
        setConfirmTarget(null);
        setCompletedOpen(true); // auto-expand to show the newly completed item
        setToast({ type: 'success', text: `"${item.item_name}" marked as done` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to confirm item' });
        setConfirmTarget(null);
      }
    } catch (err) {
      console.error('Failed to confirm item:', err);
      setToast({ type: 'error', text: 'Network error — could not confirm' });
      setConfirmTarget(null);
    } finally {
      setActionLoading(null);
    }
  };

  const handleFlag = async () => {
    if (!flagTarget) return;
    const itemName = flagTarget.item_name;
    const itemId = flagTarget.id;
    const reason = flagReason;
    setActionLoading(itemId);
    try {
      const res = await fetch(`/api/readiness/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'flagged', flagged_reason: reason }),
      });
      const data = await res.json();
      if (data.success) {
        // Update in-place — keep it visible with flagged state
        setOverdueItems(prev =>
          prev.map(i => i.id === itemId
            ? { ...i, status: 'flagged', flagged_reason: reason }
            : i
          )
        );
        setFlagTarget(null);
        setFlagReason('');
        setToast({ type: 'success', text: `"${itemName}" flagged` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to flag item' });
        setFlagTarget(null);
        setFlagReason('');
      }
    } catch (err) {
      console.error('Failed to flag item:', err);
      setToast({ type: 'error', text: 'Network error — could not flag' });
      setFlagTarget(null);
      setFlagReason('');
    } finally {
      setActionLoading(null);
    }
  };

  // Unflag — return flagged item to pending
  const handleUnflag = async (item: ReadinessItem) => {
    setActionLoading(item.id);
    try {
      const res = await fetch(`/api/readiness/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      });
      const data = await res.json();
      if (data.success) {
        setOverdueItems(prev =>
          prev.map(i => i.id === item.id
            ? { ...i, status: 'pending', flagged_reason: null }
            : i
          )
        );
        setToast({ type: 'success', text: `Flag removed from "${item.item_name}"` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to unflag' });
      }
    } catch (err) {
      console.error('Failed to unflag:', err);
      setToast({ type: 'error', text: 'Network error — could not unflag' });
    } finally {
      setActionLoading(null);
    }
  };

  // Undo done — move completed item back to active
  const handleUndoDone = async (item: CompletedItem) => {
    setActionLoading(item.id);
    try {
      const res = await fetch(`/api/readiness/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      });
      const data = await res.json();
      if (data.success) {
        // Remove from completed, add back to active
        setCompletedItems(prev => prev.filter(i => i.id !== item.id));
        setOverdueItems(prev => [...prev, {
          id: item.id,
          item_name: item.item_name,
          item_category: item.item_category,
          responsible_role: item.responsible_role,
          responsible_user_id: item.responsible_user_id,
          status: 'pending',
          due_by: item.due_by,
          escalated: false,
          escalation_level: 0,
          form_type: item.form_type,
          patient_name: item.patient_name,
          patient_thread_id: item.patient_thread_id,
        }]);
        setToast({ type: 'success', text: `"${item.item_name}" restored to active tasks` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to undo' });
      }
    } catch (err) {
      console.error('Failed to undo done:', err);
      setToast({ type: 'error', text: 'Network error — could not undo' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAssign = async (staffId: string) => {
    if (!assignTarget) return;
    const staffName = staffList.find(s => s.id === staffId)?.full_name || 'staff member';
    const itemId = assignTarget.id;
    setActionLoading(itemId);
    try {
      const res = await fetch(`/api/readiness/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: assignTarget.status === 'flagged' ? 'flagged' : 'pending', responsible_user_id: staffId }),
      });
      const data = await res.json();
      if (data.success) {
        setOverdueItems(prev =>
          prev.map(i => i.id === itemId ? { ...i, responsible_user_id: staffId } : i)
        );
        setAssignedNames(prev => ({ ...prev, [itemId]: staffName }));
        setAssignTarget(null);
        setStaffSearch('');
        setToast({ type: 'success', text: `Assigned to ${staffName}` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to assign' });
        setAssignTarget(null);
        setStaffSearch('');
      }
    } catch (err) {
      console.error('Failed to assign item:', err);
      setToast({ type: 'error', text: 'Network error — could not assign' });
      setAssignTarget(null);
      setStaffSearch('');
    } finally {
      setActionLoading(null);
    }
  };

  // Fetch staff for assign picker
  const openAssignPicker = async (item: ReadinessItem) => {
    setAssignTarget(item);
    setStaffLoading(true);
    try {
      const res = await fetch('/api/profiles?limit=100&status=active');
      const data = await res.json();
      if (data.success) {
        setStaffList(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    } finally {
      setStaffLoading(false);
    }
  };

  const filteredStaff = staffList.filter(s =>
    s.full_name?.toLowerCase().includes(staffSearch.toLowerCase()) ||
    s.role?.toLowerCase().includes(staffSearch.toLowerCase())
  );

  const activeItems = overdueItems.filter(i => i.status !== 'flagged');
  const flaggedItems = overdueItems.filter(i => i.status === 'flagged');
  const overdueCount = overdueItems.length;
  const escCount = escalations.length;

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-even-navy">Tasks</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowOTSchedule(true)}
              className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
            >
              OT Schedule
            </button>
            <button
              onClick={fetchData}
              className="p-2 text-gray-400 hover:text-even-blue hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tab pills */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('briefing')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === 'briefing'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            Briefing
          </button>
          <button
            onClick={() => setTab('overdue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === 'overdue'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            <Clock size={12} /> Overdue
            {overdueCount > 0 && (
              <span className="bg-amber-500 text-white text-[9px] px-1.5 rounded-full">{overdueCount}</span>
            )}
          </button>
          <button
            onClick={() => setTab('escalations')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === 'escalations'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            <AlertTriangle size={12} /> Escalations
            {escCount > 0 && (
              <span className="bg-red-500 text-white text-[9px] px-1.5 rounded-full">{escCount}</span>
            )}
          </button>
          <button
            onClick={() => setTab('ot_items')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === 'ot_items'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            OT Items
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {tab === 'briefing' ? (
          <DailyBriefing />
        ) : loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading tasks...</div>
        ) : tab === 'overdue' ? (
          overdueItems.length === 0 && completedItems.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={40} className="mx-auto text-green-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">All caught up!</p>
              <p className="text-gray-400 text-xs mt-1">
                No overdue readiness items.
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {/* ===== ACTIVE (pending) TASKS ===== */}
              {activeItems.map(item => (
                <div
                  key={item.id}
                  className={`bg-white rounded-xl border p-3 transition-all ${
                    item.escalated ? 'border-red-200' : 'border-amber-200'
                  } ${actionLoading === item.id ? 'opacity-50' : ''}`}
                >
                  {/* Tappable header area → navigate to patient */}
                  <div
                    className={`flex items-start justify-between gap-2 ${
                      item.patient_thread_id && onNavigateToPatient ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (item.patient_thread_id && onNavigateToPatient) {
                        onNavigateToPatient(item.patient_thread_id);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-even-navy">{item.item_name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.form_type.replace(/_/g, ' ')}
                        {item.patient_name && ` · ${item.patient_name}`}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          {item.responsible_role.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-amber-600 font-medium flex items-center gap-0.5">
                          <Clock size={9} /> {formatOverdue(item.due_by)}
                        </span>
                        {item.escalated && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                            L{item.escalation_level}
                          </span>
                        )}
                        {assignedNames[item.id] && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-0.5">
                            <UserPlus size={9} /> {assignedNames[item.id]}
                          </span>
                        )}
                      </div>
                    </div>
                    {item.patient_thread_id && onNavigateToPatient && (
                      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-gray-50">
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmTarget(item); }}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                    >
                      <Check size={12} /> Done
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openAssignPicker(item); }}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <UserPlus size={12} /> Assign
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFlagTarget(item); }}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
                    >
                      <Flag size={12} /> Flag
                    </button>
                  </div>
                </div>
              ))}

              {/* ===== FLAGGED TASKS — visible with flag banner ===== */}
              {flaggedItems.map(item => (
                <div
                  key={item.id}
                  className={`bg-orange-50/50 rounded-xl border border-orange-300 p-3 transition-all ${
                    actionLoading === item.id ? 'opacity-50' : ''
                  }`}
                >
                  {/* Flag banner */}
                  <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-orange-100 rounded-lg">
                    <Flag size={11} className="text-orange-600 shrink-0" />
                    <span className="text-[11px] font-medium text-orange-700 flex-1 min-w-0 truncate">
                      Flagged{item.flagged_reason ? `: ${item.flagged_reason}` : ''}
                    </span>
                    <button
                      onClick={() => handleUnflag(item)}
                      disabled={actionLoading === item.id}
                      className="text-[10px] text-orange-600 hover:text-orange-800 font-medium shrink-0"
                    >
                      Remove flag
                    </button>
                  </div>

                  {/* Tappable header area */}
                  <div
                    className={`flex items-start justify-between gap-2 ${
                      item.patient_thread_id && onNavigateToPatient ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (item.patient_thread_id && onNavigateToPatient) {
                        onNavigateToPatient(item.patient_thread_id);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-even-navy">{item.item_name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.form_type.replace(/_/g, ' ')}
                        {item.patient_name && ` · ${item.patient_name}`}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          {item.responsible_role.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-amber-600 font-medium flex items-center gap-0.5">
                          <Clock size={9} /> {formatOverdue(item.due_by)}
                        </span>
                        {assignedNames[item.id] && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-0.5">
                            <UserPlus size={9} /> {assignedNames[item.id]}
                          </span>
                        )}
                      </div>
                    </div>
                    {item.patient_thread_id && onNavigateToPatient && (
                      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
                    )}
                  </div>

                  {/* Actions — still allow Done and Assign on flagged items */}
                  <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-orange-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmTarget(item); }}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                    >
                      <Check size={12} /> Done
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openAssignPicker(item); }}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <UserPlus size={12} /> Assign
                    </button>
                  </div>
                </div>
              ))}

              {/* ===== COMPLETED TASKS ACCORDION ===== */}
              {completedItems.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setCompletedOpen(prev => !prev)}
                    className="flex items-center gap-2 w-full px-3 py-2.5 bg-green-50 rounded-xl text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${completedOpen ? '' : '-rotate-90'}`}
                    />
                    <CheckCircle size={14} />
                    Task Completed
                    <span className="text-[10px] bg-green-200 text-green-800 px-1.5 py-0.5 rounded-full ml-auto">
                      {completedItems.length}
                    </span>
                  </button>

                  {completedOpen && (
                    <div className="space-y-2 mt-2">
                      {completedItems.map(item => (
                        <div
                          key={item.id}
                          className={`bg-green-50/50 rounded-xl border border-green-200 p-3 transition-all ${
                            actionLoading === item.id ? 'opacity-50' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-500 line-through">
                                {item.item_name}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {item.form_type.replace(/_/g, ' ')}
                                {item.patient_name && ` · ${item.patient_name}`}
                              </div>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-0.5">
                                  <Check size={9} /> Done
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {item.confirmed_at && formatDateTime(item.confirmed_at)}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  by {item.confirmed_by_name || 'You'}
                                </span>
                              </div>
                            </div>
                            {/* Undo button */}
                            <button
                              onClick={() => handleUndoDone(item)}
                              disabled={actionLoading === item.id}
                              className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors shrink-0"
                            >
                              {actionLoading === item.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Undo2 size={11} />
                              )}
                              Undo
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ) : tab === 'ot_items' ? (
          <OTItemsTab userRole={userRole} userId={userId} onNavigateToPatient={onNavigateToPatient} />
        ) : (
          /* Escalations tab */
          escalations.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={40} className="mx-auto text-green-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">No open escalations</p>
              <p className="text-gray-400 text-xs mt-1">
                When readiness items are overdue and escalated through the chain,
                they&apos;ll appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {escalations.map(esc => {
                const levelColors = [
                  '',
                  'bg-amber-100 text-amber-700',
                  'bg-orange-100 text-orange-700',
                  'bg-red-100 text-red-700',
                  'bg-red-200 text-red-800',
                ];
                const levelStyle = levelColors[Math.min(esc.level, 4)] || levelColors[4];

                return (
                  <div key={esc.id} className="bg-white rounded-xl border border-red-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${levelStyle}`}>
                        Level {esc.level}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {formatTimeAgo(esc.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{esc.reason}</p>
                    {esc.patient_name && (
                      <p className="text-xs text-gray-400 mt-0.5">Patient: {esc.patient_name}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ===== CONFIRM MODAL ===== */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => setConfirmTarget(null)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-even-navy">Mark as Done?</h3>
              <button onClick={() => setConfirmTarget(null)} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-1">{confirmTarget.item_name}</p>
            <p className="text-xs text-gray-400 mb-4">
              {confirmTarget.form_type.replace(/_/g, ' ')}
              {confirmTarget.patient_name && ` · ${confirmTarget.patient_name}`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirm(confirmTarget)}
                disabled={actionLoading === confirmTarget.id}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {actionLoading === confirmTarget.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Confirm Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FLAG MODAL ===== */}
      {flagTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => { setFlagTarget(null); setFlagReason(''); }}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-even-navy">Flag Issue</h3>
              <button onClick={() => { setFlagTarget(null); setFlagReason(''); }} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">{flagTarget.item_name}</p>
            <textarea
              value={flagReason}
              onChange={e => setFlagReason(e.target.value)}
              placeholder="Why is this flagged? (e.g., patient refused, equipment unavailable)"
              className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-orange-300"
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setFlagTarget(null); setFlagReason(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleFlag}
                disabled={!flagReason.trim() || actionLoading === flagTarget.id}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {actionLoading === flagTarget.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Flag size={14} />
                )}
                Flag Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {toast.text}
        </div>
      )}

      {/* ===== ASSIGN MODAL ===== */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => { setAssignTarget(null); setStaffSearch(''); }}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-even-navy">Assign To</h3>
              <button onClick={() => { setAssignTarget(null); setStaffSearch(''); }} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              {assignTarget.item_name} · {assignTarget.patient_name || 'No patient'}
            </p>

            {/* Search */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                placeholder="Search staff by name or role..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                autoFocus
              />
            </div>

            {/* Staff list */}
            <div className="flex-1 overflow-y-auto space-y-1">
              {staffLoading ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  Loading staff...
                </div>
              ) : filteredStaff.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No staff found</div>
              ) : (
                filteredStaff.map(staff => (
                  <button
                    key={staff.id}
                    onClick={() => handleAssign(staff.id)}
                    disabled={actionLoading === assignTarget.id}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-medium text-even-navy">{staff.full_name}</div>
                      <div className="text-[11px] text-gray-400">{staff.role?.replace(/_/g, ' ')}</div>
                    </div>
                    {actionLoading === assignTarget.id ? (
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-300" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* OT Schedule full-screen overlay */}
      {showOTSchedule && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <button
              onClick={() => setShowOTSchedule(false)}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <X size={18} />
              Close
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <OTSchedulePage userRole={userRole} userId={userId} />
          </div>
        </div>
      )}
    </div>
  );
}
