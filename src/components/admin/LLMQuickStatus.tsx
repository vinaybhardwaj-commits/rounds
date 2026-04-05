'use client';

import Link from 'next/link';

interface LLMCall {
  id?: string;
  time: string;
  analysis_type: string;
  latency_ms: number;
  tokens: number;
  status: string;
}

interface LLMQuickStatusProps {
  calls?: LLMCall[];
  loading?: boolean;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

function latencyColor(ms: number): string {
  if (ms < 3000) return 'text-green-600';
  if (ms < 8000) return 'text-amber-600';
  return 'text-red-600';
}

function statusIcon(status: string): string {
  if (status === 'success') return '✅';
  if (status === 'fallback') return '⚠️';
  return '❌';
}

export function LLMQuickStatus({ calls, loading }: LLMQuickStatusProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="h-4 w-28 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-6 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const items = calls || [];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-even-navy">LLM Calls</h3>
        <Link href="/admin/llm" className="text-xs text-even-blue hover:underline">
          Observatory →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-xs text-gray-500">No LLM calls recorded yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1.5 font-medium">Time</th>
                <th className="text-left py-1.5 font-medium">Type</th>
                <th className="text-right py-1.5 font-medium">Latency</th>
                <th className="text-right py-1.5 font-medium">Tokens</th>
                <th className="text-center py-1.5 font-medium w-6"></th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map((call, i) => (
                <tr key={call.id || i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-1.5 text-gray-500 font-mono tabular-nums">{formatTime(call.time)}</td>
                  <td className="py-1.5 text-even-navy font-medium truncate max-w-24">{call.analysis_type}</td>
                  <td className={`py-1.5 text-right font-mono tabular-nums ${latencyColor(call.latency_ms)}`}>
                    {(call.latency_ms / 1000).toFixed(1)}s
                  </td>
                  <td className="py-1.5 text-right text-gray-500 tabular-nums">
                    {call.tokens > 0 ? call.tokens.toLocaleString() : '—'}
                  </td>
                  <td className="py-1.5 text-center">{statusIcon(call.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
