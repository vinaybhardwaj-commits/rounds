'use client';

import Link from 'next/link';
import { AlertOctagon, AlertTriangle } from 'lucide-react';

interface ErrorIncident {
  message: string;
  count: number;
  affected_users: number;
  is_new?: boolean;
  last_seen?: string;
}

interface ErrorSummaryCompactProps {
  errors?: ErrorIncident[];
  loading?: boolean;
}

export function ErrorSummaryCompact({ errors, loading }: ErrorSummaryCompactProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const items = errors || [];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-even-navy">Errors (1h)</h3>
        <Link href="/admin/errors" className="text-xs text-even-blue hover:underline">
          View all →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-4">
          <span className="text-green-500 text-lg">✓</span>
          <p className="text-xs text-gray-500 mt-1">No errors in the last hour</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 5).map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {err.is_new ? (
                <AlertOctagon size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-even-navy truncate leading-snug">{err.message}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">×{err.count} in last hour</span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{err.affected_users} user{err.affected_users !== 1 ? 's' : ''}</span>
                  {err.is_new && (
                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">NEW</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
