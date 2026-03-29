'use client';

// ============================================
// DailyBriefing — AI-generated morning briefing.
// Shows in Tasks tab or as standalone page.
// Step 8.2: AI Daily Briefing
// ============================================

import { useState, useEffect } from 'react';
import {
  Brain,
  Sun,
  Users,
  Stethoscope,
  LogOut,
  AlertTriangle,
  Flame,
  UserCheck,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface BriefingSection {
  count: number;
  highlights: string[];
}

interface BriefingData {
  date: string;
  summary: string;
  sections: {
    admissions: BriefingSection;
    surgeries: BriefingSection;
    discharges: BriefingSection;
    overdue_items: BriefingSection;
    escalations: BriefingSection;
    staff_alerts: string[];
  };
  action_items: Array<{ priority: 'high' | 'medium' | 'low'; text: string }>;
}

const PRIORITY_COLORS = {
  high: 'bg-red-50 text-red-700 border-l-red-500',
  medium: 'bg-orange-50 text-orange-700 border-l-orange-500',
  low: 'bg-blue-50 text-blue-700 border-l-blue-500',
};

const SECTION_CONFIG = [
  { key: 'admissions', label: 'Admissions', icon: Users, color: 'text-blue-500' },
  { key: 'surgeries', label: 'Surgeries', icon: Stethoscope, color: 'text-red-500' },
  { key: 'discharges', label: 'Discharges', icon: LogOut, color: 'text-green-500' },
  { key: 'overdue_items', label: 'Overdue Items', icon: AlertTriangle, color: 'text-orange-500' },
  { key: 'escalations', label: 'Escalations', icon: Flame, color: 'text-red-600' },
] as const;

export function DailyBriefing() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchBriefing = async (force = false) => {
    setLoading(true);
    try {
      const res = force
        ? await fetch('/api/ai/briefing', { method: 'POST' })
        : await fetch('/api/ai/briefing');
      const data = await res.json();
      if (data.success) {
        setBriefing(data.data);
        setGeneratedAt(data.generated_at);
      }
    } catch (err) {
      console.error('Failed to fetch briefing:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBriefing();
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <Brain size={20} className="text-purple-500" />
          <span className="text-sm font-semibold text-even-navy">AI Morning Briefing</span>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-xs text-gray-400">Generating briefing...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <Brain size={20} className="text-purple-500" />
          <span className="text-sm font-semibold text-even-navy">AI Morning Briefing</span>
        </div>
        <div className="text-center py-8">
          <p className="text-sm text-gray-400 mb-3">No briefing available yet.</p>
          <button
            onClick={() => fetchBriefing(true)}
            className="text-xs text-purple-500 font-medium hover:text-purple-700"
          >
            Generate Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
          <Sun size={18} className="text-purple-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-even-navy">Morning Briefing</h2>
          <p className="text-[10px] text-gray-400">
            {briefing.date}
            {generatedAt && ` · ${new Date(generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button
          onClick={() => fetchBriefing(true)}
          disabled={loading}
          className="p-1.5 text-gray-400 hover:text-purple-500 transition-colors"
          title="Regenerate"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary */}
      <div className="bg-purple-50 rounded-xl p-3 mb-4">
        <p className="text-sm text-purple-900">{briefing.summary}</p>
      </div>

      {/* Section cards */}
      <div className="space-y-2 mb-4">
        {SECTION_CONFIG.map(({ key, label, icon: Icon, color }) => {
          const section = briefing.sections[key];
          const isExpanded = expandedSection === key;
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setExpandedSection(isExpanded ? null : key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <Icon size={16} className={color} />
                <span className="text-sm text-even-navy flex-1">{label}</span>
                <span className="text-sm font-bold text-even-navy">{section.count}</span>
                {section.highlights.length > 0 && (
                  isExpanded ? <ChevronUp size={14} className="text-gray-300" /> : <ChevronDown size={14} className="text-gray-300" />
                )}
              </button>
              {isExpanded && section.highlights.length > 0 && (
                <div className="px-3 pb-2.5 border-t border-gray-50">
                  <div className="pt-2 space-y-1">
                    {section.highlights.map((h, i) => (
                      <p key={i} className="text-xs text-gray-600 pl-7">• {h}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Staff alerts */}
        {briefing.sections.staff_alerts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck size={16} className="text-gray-500" />
              <span className="text-sm text-even-navy font-medium">Staff Alerts</span>
            </div>
            <div className="space-y-1">
              {briefing.sections.staff_alerts.map((alert, i) => (
                <p key={i} className="text-xs text-gray-600 pl-6">• {alert}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action items */}
      {briefing.action_items.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Action Items
          </h3>
          <div className="space-y-1.5">
            {briefing.action_items.map((item, i) => (
              <div
                key={i}
                className={`px-3 py-2 rounded-lg border-l-2 text-xs ${PRIORITY_COLORS[item.priority]}`}
              >
                {item.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
