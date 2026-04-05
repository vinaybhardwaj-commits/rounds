'use client';

import { AlertTriangle, TrendingDown, Search, Moon, UserX } from 'lucide-react';

interface Signal {
  type: 'never_logged_in' | 'dept_dark' | 'bounce_session' | 'help_gap' | 'form_dropoff';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  action: string;
  meta?: Record<string, unknown>;
}

interface AdoptionSignalsFeedProps {
  signals?: Signal[];
  loading?: boolean;
}

const typeConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  never_logged_in: { icon: <UserX size={16} />, color: 'text-red-500 bg-red-50' },
  dept_dark: { icon: <Moon size={16} />, color: 'text-amber-600 bg-amber-50' },
  bounce_session: { icon: <UserX size={16} />, color: 'text-orange-500 bg-orange-50' },
  help_gap: { icon: <Search size={16} />, color: 'text-blue-500 bg-blue-50' },
  form_dropoff: { icon: <TrendingDown size={16} />, color: 'text-purple-500 bg-purple-50' },
};

const severityBorder: Record<string, string> = {
  critical: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-400',
};

export function AdoptionSignalsFeed({ signals, loading }: AdoptionSignalsFeedProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="h-4 w-40 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const items = signals || [];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-even-navy">Adoption Signals</h3>
        {items.length > 0 && (
          <span className="text-xs text-gray-400">{items.length} signal{items.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-green-500 text-2xl mb-2">✓</div>
          <div className="text-sm text-gray-500">No adoption signals — all clear</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {items.map((signal, i) => {
            const config = typeConfig[signal.type] || typeConfig.never_logged_in;
            const [iconColor, iconBg] = config.color.split(' ');

            return (
              <div
                key={i}
                className={`border-l-3 ${severityBorder[signal.severity] || 'border-l-gray-300'} bg-gray-50 rounded-r-lg p-3 hover:bg-gray-100 transition-colors cursor-pointer`}
                style={{ borderLeftWidth: '3px' }}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full ${iconBg} ${iconColor} flex items-center justify-center mt-0.5`}>
                    {config.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-even-navy leading-snug">{signal.message}</p>
                    <p className="text-xs text-gray-500 mt-1">→ {signal.action}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
