'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface StreamEvent {
  type: 'activity' | 'error' | 'llm';
  timestamp: string;
  message: string;
  category?: string;
  meta?: Record<string, unknown>;
}

interface LiveActivityStreamProps {
  maxEvents?: number;
}

const categoryStyles: Record<string, { dot: string; text: string }> = {
  session: { dot: 'bg-green-500', text: 'text-green-700' },
  feature: { dot: 'bg-blue-500', text: 'text-blue-700' },
  form: { dot: 'bg-orange-500', text: 'text-orange-700' },
  ai: { dot: 'bg-purple-500', text: 'text-purple-700' },
  error: { dot: 'bg-red-500', text: 'text-red-700' },
  help: { dot: 'bg-teal-500', text: 'text-teal-700' },
  workflow: { dot: 'bg-amber-500', text: 'text-amber-700' },
};

function categorize(evt: StreamEvent): string {
  if (evt.type === 'error') return 'error';
  if (evt.type === 'llm') return 'ai';
  if (evt.category) return evt.category;
  const msg = evt.message.toLowerCase();
  if (msg.includes('login') || msg.includes('session')) return 'session';
  if (msg.includes('form')) return 'form';
  if (msg.includes('help')) return 'help';
  if (msg.includes('stage')) return 'workflow';
  return 'feature';
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '--:--:--';
  }
}

export function LiveActivityStream({ maxEvents = 50 }: LiveActivityStreamProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);

  pausedRef.current = paused;

  const addEvent = useCallback((evt: StreamEvent) => {
    if (pausedRef.current) return;
    setEvents(prev => {
      const next = [evt, ...prev];
      return next.slice(0, maxEvents);
    });
  }, [maxEvents]);

  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        es = new EventSource('/api/admin/stream');
        eventSourceRef.current = es;

        es.onopen = () => setConnected(true);

        es.addEventListener('activity', (e) => {
          try {
            const data = JSON.parse(e.data);
            addEvent({ type: 'activity', timestamp: data.ts || new Date().toISOString(), message: data.message || data.description || 'Activity', category: data.category, meta: data });
          } catch {}
        });

        es.addEventListener('error_event', (e) => {
          try {
            const data = JSON.parse(e.data);
            addEvent({ type: 'error', timestamp: data.ts || new Date().toISOString(), message: data.message || 'Error', category: 'error', meta: data });
          } catch {}
        });

        es.addEventListener('llm', (e) => {
          try {
            const data = JSON.parse(e.data);
            addEvent({ type: 'llm', timestamp: data.ts || new Date().toISOString(), message: `LLM: ${data.analysis_type || data.type} — ${data.latency_ms ? (data.latency_ms / 1000).toFixed(1) + 's' : '?'}, ${data.tokens || '?'} tok`, category: 'ai', meta: data });
          } catch {}
        });

        es.onerror = () => {
          setConnected(false);
          es.close();
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      if (es) es.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [addEvent]);

  const filters = ['all', 'session', 'form', 'ai', 'error', 'help'];
  const filtered = filter === 'all' ? events : events.filter(e => categorize(e) === filter);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col" style={{ maxHeight: '400px' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-even-navy">Live Activity</h3>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          {connected && <span className="text-xs text-green-600">LIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused(!paused)}
            className={`text-xs px-2 py-1 rounded ${paused ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      {/* Filter toggles */}
      <div className="flex gap-1 mb-3">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1 rounded-md transition-colors capitalize ${
              filter === f ? 'bg-even-blue text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Event stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">
            {connected ? 'Waiting for activity...' : 'Connecting...'}
          </div>
        ) : (
          filtered.map((evt, i) => {
            const cat = categorize(evt);
            const style = categoryStyles[cat] || categoryStyles.feature;

            return (
              <div
                key={`${evt.timestamp}-${i}`}
                className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-50 transition-colors text-xs"
              >
                <span className="text-gray-400 font-mono tabular-nums flex-shrink-0 w-16">
                  {formatTime(evt.timestamp)}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot} mt-1.5 flex-shrink-0`} />
                <span className={`${style.text} flex-1 leading-snug`}>{evt.message}</span>
                <span className="text-gray-300 uppercase tracking-wider flex-shrink-0" style={{ fontSize: '9px' }}>
                  {cat}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
