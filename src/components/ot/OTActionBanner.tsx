'use client';

// ============================================
// OTActionBanner — Shows in PatientsView when
// the current user has pending OT readiness items.
// "3 OT items need your action [View →]"
// ============================================

import React, { useState, useEffect } from 'react';
import { Activity, ChevronRight } from 'lucide-react';

interface OTActionBannerProps {
  onViewOTItems?: () => void;
}

export function OTActionBanner({ onViewOTItems }: OTActionBannerProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/ot/readiness/mine?count_only=true', { signal: controller.signal });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && typeof data.data === 'number') {
          setCount(data.data);
        } else if (data.success && data.data?.count !== undefined) {
          setCount(data.data.count);
        }
      } catch {
        // Non-fatal (includes AbortError on unmount)
      }
    };

    fetchCount();
    let interval = setInterval(fetchCount, 120_000); // Refresh every 2 min
    const handleOtChange = () => fetchCount();
    window.addEventListener('ot-items-changed', handleOtChange);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('ot-items-changed', handleOtChange);
    };
  }, [onViewOTItems]);

  if (count === 0) return null;

  return (
    <button
      onClick={onViewOTItems}
      className="mx-4 mb-2 flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-3.5 py-2.5 w-[calc(100%-2rem)] text-left hover:bg-blue-100/70 transition-colors"
    >
      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
        <Activity size={14} className="text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-blue-800">
          {count} OT item{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} your action
        </p>
        <p className="text-[10px] text-blue-500">Surgery readiness tasks assigned to you</p>
      </div>
      <ChevronRight size={14} className="text-blue-400 shrink-0" />
    </button>
  );
}
