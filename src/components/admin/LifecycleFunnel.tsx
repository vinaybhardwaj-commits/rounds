'use client';

import { useState } from 'react';

interface FunnelData {
  signed_up: number;
  approved: number;
  first_login: number;
  active_7d: number;
  regular_30d: number;
}

interface LifecycleFunnelProps {
  data?: FunnelData;
  loading?: boolean;
}

const stages = [
  { key: 'signed_up', label: 'Signed Up', color: 'bg-gray-400' },
  { key: 'approved', label: 'Approved', color: 'bg-blue-400' },
  { key: 'first_login', label: 'First Login', color: 'bg-indigo-500' },
  { key: 'active_7d', label: 'Active (7d)', color: 'bg-even-blue' },
  { key: 'regular_30d', label: 'Regular (30d)', color: 'bg-even-green' },
] as const;

export function LifecycleFunnel({ data, loading }: LifecycleFunnelProps) {
  const [period, setPeriod] = useState<'7d' | '14d' | '30d' | 'all'>('all');

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="h-4 w-40 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="flex items-center justify-between gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex-1 h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const d = data || { signed_up: 0, approved: 0, first_login: 0, active_7d: 0, regular_30d: 0 };
  const values = stages.map(s => d[s.key as keyof FunnelData]);
  const maxVal = Math.max(...values, 1);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-even-navy">Adoption Funnel</h3>
        <div className="flex gap-1">
          {(['7d', '14d', '30d', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                period === p
                  ? 'bg-even-blue text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Funnel visualization */}
      <div className="flex items-end gap-1">
        {stages.map((stage, i) => {
          const val = values[i];
          const prevVal = i > 0 ? values[i - 1] : val;
          const conversion = prevVal > 0 ? Math.round((val / prevVal) * 100) : 0;
          const barHeight = maxVal > 0 ? Math.max((val / maxVal) * 100, 8) : 8;
          const dropSeverity = i > 0 ? (conversion < 40 ? 'text-red-600' : conversion < 70 ? 'text-amber-600' : 'text-gray-500') : '';

          return (
            <div key={stage.key} className="flex-1 flex flex-col items-center gap-1">
              {/* Conversion rate between stages */}
              {i > 0 && (
                <div className={`text-xs font-medium ${dropSeverity} mb-1`}>
                  {conversion}%
                </div>
              )}
              {i === 0 && <div className="text-xs text-transparent mb-1">&nbsp;</div>}

              {/* Bar */}
              <div className="w-full flex flex-col items-center">
                <div
                  className={`w-full ${stage.color} rounded-t-md transition-all duration-500 cursor-pointer hover:opacity-80`}
                  style={{ height: `${barHeight}px`, minHeight: '8px', maxHeight: '80px' }}
                  title={`${stage.label}: ${val} users`}
                />
              </div>

              {/* Count */}
              <div className="text-lg font-bold text-even-navy">{val}</div>

              {/* Label */}
              <div className="text-xs text-gray-500 text-center leading-tight">{stage.label}</div>
            </div>
          );
        })}
      </div>

      {/* Arrows between stages */}
      <div className="flex items-center justify-center mt-2 px-4">
        {stages.slice(0, -1).map((_, i) => (
          <div key={i} className="flex-1 flex justify-center">
            <svg width="20" height="10" viewBox="0 0 20 10" className="text-gray-300">
              <path d="M0 5 L15 5 M12 2 L15 5 L12 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
