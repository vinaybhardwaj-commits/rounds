'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck,
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Filter,
} from 'lucide-react';

interface ReadinessItem {
  id: string;
  item_name: string;
  item_category: string;
  responsible_role: string;
  status: string;
  due_by: string | null;
  escalated: boolean;
  escalation_level: number;
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

type TaskTab = 'overdue' | 'escalations';

export function TasksView() {
  const [tab, setTab] = useState<TaskTab>('overdue');
  const [overdueItems, setOverdueItems] = useState<ReadinessItem[]>([]);
  const [escalations, setEscalations] = useState<EscalationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overdueRes, escRes] = await Promise.all([
        fetch('/api/readiness/overdue'),
        fetch('/api/escalation/log?resolved=false'),
      ]);

      // Overdue endpoint may not exist yet — handle gracefully
      if (overdueRes.ok) {
        const overdueData = await overdueRes.json();
        if (overdueData.success) setOverdueItems(overdueData.data || []);
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

  const formatTimeAgo = (d: string) => {
    const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  const overdueCount = overdueItems.length;
  const escCount = escalations.length;

  return (
    <div className="flex flex-col h-full bg-even-white">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-even-navy">Tasks</h1>
          <button
            onClick={fetchData}
            className="p-2 text-gray-400 hover:text-even-blue hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </div>

        {/* Tab pills */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('overdue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === 'overdue'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            <Clock size={12} /> Overdue Items
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
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-20">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading tasks...</div>
        ) : tab === 'overdue' ? (
          overdueItems.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={40} className="mx-auto text-green-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">All caught up!</p>
              <p className="text-gray-400 text-xs mt-1">
                No overdue readiness items. When forms are submitted with SLA deadlines
                and items aren&apos;t completed on time, they&apos;ll appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {overdueItems.map(item => {
                const overdueMins = item.due_by
                  ? Math.round((Date.now() - new Date(item.due_by).getTime()) / 60000)
                  : 0;
                const overdueStr = overdueMins >= 60
                  ? `${Math.round(overdueMins / 60)}h ${overdueMins % 60}m overdue`
                  : `${overdueMins}m overdue`;

                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-xl border p-3 ${
                      item.escalated ? 'border-red-200' : 'border-amber-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-even-navy">{item.item_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {item.form_type.replace(/_/g, ' ')}
                          {item.patient_name && ` · ${item.patient_name}`}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {item.responsible_role.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-amber-600 font-medium flex items-center gap-0.5">
                            <Clock size={9} /> {overdueStr}
                          </span>
                        </div>
                      </div>
                      {item.escalated && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                          L{item.escalation_level}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          escalations.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={40} className="mx-auto text-green-200 mb-3" />
              <p className="text-gray-500 font-medium text-sm">No open escalations</p>
              <p className="text-gray-400 text-xs mt-1">
                When readiness items are overdue and escalated through the chain
                (responsible → dept head → on-duty → ops), they&apos;ll appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {escalations.map(esc => {
                const levelColors = [
                  '', // no level 0
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
    </div>
  );
}
