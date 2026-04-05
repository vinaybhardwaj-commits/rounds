'use client';

import Link from 'next/link';
import { Activity, AlertTriangle, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { Sparkline } from './Sparkline';

interface HealthStatus {
  llm: {
    status: 'healthy' | 'degraded' | 'down';
    latency_ms: number;
  };
  errors_1h: number;
  error_sparkline: number[];
  active_sessions: number;
  api_p95_ms: number;
  api_trend: 'up' | 'down' | 'stable';
  forms_today: number;
  forms_yesterday: number;
  last_deploy: {
    time: string;
    sha: string;
  };
}

interface HealthBarProps {
  health?: HealthStatus;
}

/**
 * Fixed 48px top bar with 6 system health indicators.
 * Displays LLM status, error rate, active sessions, API latency, forms submitted, and last deploy.
 */
export function HealthBar({ health }: HealthBarProps) {
  // Default mock data for development
  const defaultHealth: HealthStatus = {
    llm: { status: 'healthy', latency_ms: 2100 },
    errors_1h: 2,
    error_sparkline: [1, 2, 1, 3, 2, 1],
    active_sessions: 24,
    api_p95_ms: 340,
    api_trend: 'stable',
    forms_today: 156,
    forms_yesterday: 142,
    last_deploy: { time: '2h ago', sha: 'a14f9a0' },
  };

  const data = health || defaultHealth;

  const getLLMColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return '#22C55E';
      case 'degraded':
        return '#F97316';
      case 'down':
        return '#EF4444';
      default:
        return '#9CA3AF';
    }
  };

  const getErrorTrend = () => {
    const avg = data.error_sparkline.reduce((a, b) => a + b, 0) / data.error_sparkline.length;
    const last = data.error_sparkline[data.error_sparkline.length - 1];
    return last > avg ? 'up' : 'down';
  };

  const formsDelta = data.forms_today - data.forms_yesterday;
  const formsDeltaPercent = data.forms_yesterday > 0
    ? ((formsDelta / data.forms_yesterday) * 100).toFixed(0)
    : 0;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-gray-900 border-b border-gray-800">
      <div className="h-full px-6 flex items-center justify-between gap-8">
        {/* LLM Tunnel */}
        <Link
          href="/admin/llm"
          className="flex items-center gap-2 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View LLM Observatory"
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: getLLMColor(data.llm.status) }}
            />
          </div>
          <span className="text-gray-300 group-hover:text-white">
            LLM {(data.llm.latency_ms / 1000).toFixed(1)}s
          </span>
        </Link>

        {/* Error Rate */}
        <Link
          href="/admin/errors"
          className="flex items-center gap-2 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View Error Forensics"
        >
          {getErrorTrend() === 'up' ? (
            <TrendingUp size={14} className="text-red-500 flex-shrink-0" />
          ) : (
            <TrendingDown size={14} className="text-green-500 flex-shrink-0" />
          )}
          <span className="text-gray-300 group-hover:text-white font-mono">{data.errors_1h}</span>
          <Sparkline
            data={data.error_sparkline}
            width={48}
            height={16}
            color={getErrorTrend() === 'up' ? '#EF4444' : '#22C55E'}
            className="flex-shrink-0"
          />
        </Link>

        {/* Active Sessions */}
        <Link
          href="/admin/sessions"
          className="flex items-center gap-2 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View Active Sessions"
        >
          <Activity size={14} className="text-blue-400 flex-shrink-0" />
          <span className="text-gray-300 group-hover:text-white">
            {data.active_sessions}
            <span className="ml-1 inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          </span>
        </Link>

        {/* API Latency */}
        <Link
          href="/admin/api-performance"
          className="flex items-center gap-2 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View API Performance"
        >
          <Gauge size={14} className="text-amber-400 flex-shrink-0" />
          <span className="text-gray-300 group-hover:text-white font-mono">
            p95: {data.api_p95_ms}ms
          </span>
          {data.api_trend === 'up' && (
            <TrendingUp size={12} className="text-red-500 flex-shrink-0" />
          )}
          {data.api_trend === 'down' && (
            <TrendingDown size={12} className="text-green-500 flex-shrink-0" />
          )}
        </Link>

        {/* Forms Today */}
        <Link
          href="/admin/forms"
          className="flex items-center gap-2 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View Form Analytics"
        >
          <span className="text-gray-300 group-hover:text-white font-mono">{data.forms_today}</span>
          <span
            className={`text-xs font-medium ${
              formsDelta >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {formsDelta >= 0 ? '+' : ''}{formsDeltaPercent}%
          </span>
        </Link>

        {/* Last Deploy */}
        <Link
          href="https://github.com/even-hospital/rounds/commits"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs hover:bg-gray-800 px-2 py-1 rounded transition-colors group"
          title="View commit on GitHub"
        >
          <span className="text-gray-400 group-hover:text-gray-200">{data.last_deploy.time}</span>
          <span className="text-gray-500 font-mono">{data.last_deploy.sha}</span>
        </Link>
      </div>
    </header>
  );
}
