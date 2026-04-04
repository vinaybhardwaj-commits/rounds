'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface HealthStatus {
  healthy: boolean;
  latency_ms: number;
  model: string | null;
  base_url_set: boolean;
  error?: string;
  response?: string;
}

type CheckState = 'idle' | 'checking' | 'healthy' | 'unhealthy' | 'no-config';

export function LlmHealthIndicator() {
  const [state, setState] = useState<CheckState>('idle');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    setState('checking');
    try {
      const res = await fetch('/api/llm-health', { cache: 'no-store' });
      const data: HealthStatus = await res.json();
      setHealth(data);
      setLastChecked(new Date());

      if (!data.base_url_set) {
        setState('no-config');
      } else if (data.healthy) {
        setState('healthy');
      } else {
        setState('unhealthy');
      }
    } catch {
      setHealth(null);
      setState('unhealthy');
      setLastChecked(new Date());
    }
  }, []);

  // Auto-check on mount
  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const statusConfig = {
    idle: { color: 'text-gray-400', bg: 'bg-gray-50', dot: 'bg-gray-300', label: 'Not checked' },
    checking: { color: 'text-blue-500', bg: 'bg-blue-50', dot: 'bg-blue-400 animate-pulse', label: 'Checking...' },
    healthy: { color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500', label: 'Connected' },
    unhealthy: { color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500', label: 'Unreachable' },
    'no-config': { color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-400', label: 'Not configured' },
  };

  const cfg = statusConfig[state];

  const StatusIcon = state === 'healthy' ? CheckCircle
    : state === 'no-config' ? AlertTriangle
    : state === 'unhealthy' ? XCircle
    : Cpu;

  return (
    <div className={`rounded-xl border border-gray-100 overflow-hidden ${cfg.bg}`}>
      <div className="px-4 py-3.5 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <StatusIcon size={18} className={cfg.color} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-even-navy">AI Engine</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            </div>

            {state === 'healthy' && health && (
              <div className="text-xs text-gray-500 mt-0.5 truncate">
                {health.model} &middot; {health.latency_ms}ms
              </div>
            )}

            {state === 'unhealthy' && health?.error && (
              <div className="text-xs text-red-500 mt-0.5 truncate">
                {health.error}
              </div>
            )}

            {state === 'no-config' && (
              <div className="text-xs text-amber-600 mt-0.5">
                Set LLM_BASE_URL in Vercel env vars
              </div>
            )}
          </div>
        </div>

        <button
          onClick={checkHealth}
          disabled={state === 'checking'}
          className="p-1.5 text-gray-400 hover:text-even-blue hover:bg-white/60 rounded-lg transition-colors disabled:opacity-40"
          title="Check LLM connection"
        >
          <RefreshCw size={14} className={state === 'checking' ? 'animate-spin' : ''} />
        </button>
      </div>

      {lastChecked && state !== 'checking' && (
        <div className="px-4 pb-2 text-[10px] text-gray-400">
          Last checked {lastChecked.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
