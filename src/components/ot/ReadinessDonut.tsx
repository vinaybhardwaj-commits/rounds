'use client';

// ============================================
// ReadinessDonut — Reusable SVG donut chart
// Shows confirmed/pending/flagged/blocked/NA
// breakdown with center text.
// ============================================

import React from 'react';

interface DonutData {
  confirmed: number;
  pending: number;
  flagged: number;
  blocked: number;
  not_applicable: number;
}

interface ReadinessDonutProps {
  data: DonutData;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  className?: string;
}

const COLORS = {
  confirmed: '#22c55e',    // green-500
  pending: '#f59e0b',      // amber-500
  flagged: '#ef4444',      // red-500
  blocked: '#dc2626',      // red-600
  not_applicable: '#d1d5db', // gray-300
};

export function ReadinessDonut({
  data,
  size = 48,
  strokeWidth = 6,
  showLabel = true,
  className = '',
}: ReadinessDonutProps) {
  const total = data.confirmed + data.pending + data.flagged + data.blocked + data.not_applicable;
  const activeTotal = total - data.not_applicable;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  if (total === 0) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div
          className="rounded-full border-4 border-gray-200 flex items-center justify-center"
          style={{ width: size, height: size }}
        >
          <span className="text-[9px] text-gray-400">—</span>
        </div>
        {showLabel && <span className="text-xs text-gray-400">No items</span>}
      </div>
    );
  }

  // Build segments in order: confirmed → pending → flagged → blocked → NA
  const segments: { color: string; value: number }[] = [
    { color: COLORS.confirmed, value: data.confirmed },
    { color: COLORS.pending, value: data.pending },
    { color: COLORS.flagged, value: data.flagged },
    { color: COLORS.blocked, value: data.blocked },
    { color: COLORS.not_applicable, value: data.not_applicable },
  ].filter(s => s.value > 0);

  let offset = 0;
  const percentage = activeTotal > 0 ? Math.round((data.confirmed / activeTotal) * 100) : 0;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth={strokeWidth}
        />
        {/* Data segments */}
        {segments.map((seg, i) => {
          const segLen = (seg.value / total) * circumference;
          const dashArray = `${segLen} ${circumference - segLen}`;
          const dashOffset = -offset;
          offset += segLen;
          return (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      {showLabel && (
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-gray-800">
            {data.confirmed}/{activeTotal}
          </span>
          <span className="text-[10px] text-gray-400">
            {percentage}% ready
          </span>
        </div>
      )}
    </div>
  );
}

/** Utility to convert OTReadinessItem[] into DonutData */
export function toDonutData(items: { status: string }[]): DonutData {
  const data: DonutData = { confirmed: 0, pending: 0, flagged: 0, blocked: 0, not_applicable: 0 };
  for (const item of items) {
    switch (item.status) {
      case 'confirmed': data.confirmed++; break;
      case 'pending': data.pending++; break;
      case 'flagged': data.flagged++; break;
      case 'blocked': data.blocked++; break;
      case 'not_applicable': data.not_applicable++; break;
    }
  }
  return data;
}
