// ============================================
// Session Tracker — full session analytics
//
// Tracks: page views, feature usage, session
// duration, user flows. All data stored in Neon
// via /api/analytics/event endpoint.
//
// Setup: call initSessionTracker() in layout.
// ============================================

const ANALYTICS_ENDPOINT = '/api/analytics/event';
const FLUSH_INTERVAL_MS = 10_000; // flush every 10s
const MAX_BATCH = 25;

interface AnalyticsEvent {
  event_type: string;
  page?: string;
  feature?: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}

let sessionId: string = '';
let eventQueue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionStartTime = 0;
let lastActivityTime = 0;
let currentPage = '';

function generateSessionId(): string {
  // Simple UUID v4-ish
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function enqueue(event: AnalyticsEvent) {
  eventQueue.push(event);
  lastActivityTime = Date.now();

  if (eventQueue.length >= MAX_BATCH) {
    flush();
  }
}

async function flush() {
  const batch = eventQueue.splice(0, MAX_BATCH);
  if (batch.length === 0) return;

  try {
    const payload = {
      sessionId,
      events: batch,
    };

    // Use sendBeacon for reliability during page unload
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        ANALYTICS_ENDPOINT,
        new Blob([JSON.stringify(payload)], { type: 'application/json' })
      );
    } else {
      fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Silently fail
  }
}

// ── Public API ──

/**
 * Track a page view. Call on route changes.
 */
export function trackPageView(page: string) {
  if (page === currentPage) return; // Skip duplicate
  currentPage = page;
  enqueue({
    event_type: 'page_view',
    page,
    timestamp: Date.now(),
  });
}

/**
 * Track a feature usage (button click, form submit, etc.)
 */
export function trackFeature(feature: string, detail?: Record<string, unknown>) {
  enqueue({
    event_type: 'feature_use',
    page: currentPage,
    feature,
    detail,
    timestamp: Date.now(),
  });
}

/**
 * Track a custom event.
 */
export function trackEvent(eventType: string, detail?: Record<string, unknown>) {
  enqueue({
    event_type: eventType,
    page: currentPage,
    detail,
    timestamp: Date.now(),
  });
}

// ── Admin Intelligence: Enhanced Event Tracking ──

/**
 * Track form field focus — which fields users interact with.
 * Call when a form field receives focus or changes.
 */
export function trackFormFieldFocus(formType: string, fieldName: string, fieldIndex: number) {
  enqueue({
    event_type: 'form_field_focus',
    page: currentPage,
    feature: `form:${formType}`,
    detail: { form_type: formType, field_name: fieldName, field_index: fieldIndex },
    timestamp: Date.now(),
  });
}

/**
 * Track form abandonment — when a user navigates away without submitting.
 * Call in form component cleanup (useEffect return) or beforeunload.
 */
export function trackFormAbandon(
  formType: string,
  lastField: string,
  fieldsCompleted: number,
  totalFields: number
) {
  enqueue({
    event_type: 'form_abandon',
    page: currentPage,
    feature: `form:${formType}`,
    detail: {
      form_type: formType,
      last_field: lastField,
      fields_completed: fieldsCompleted,
      total_fields: totalFields,
      completion_pct: totalFields > 0 ? Math.round((fieldsCompleted / totalFields) * 100) : 0,
    },
    timestamp: Date.now(),
  });
  flush(); // Flush immediately — user is leaving
}

/**
 * Track help system search.
 */
export function trackHelpSearch(query: string, resultsCount: number) {
  enqueue({
    event_type: 'help_search',
    page: currentPage,
    feature: 'help',
    detail: { query, results_count: resultsCount },
    timestamp: Date.now(),
  });
}

/**
 * Track help manifest/topic view.
 */
export function trackHelpView(manifestId: string, topic: string) {
  enqueue({
    event_type: 'help_view',
    page: currentPage,
    feature: 'help',
    detail: { manifest_id: manifestId, topic },
    timestamp: Date.now(),
  });
}

/**
 * Track when a user encounters an error.
 */
export function trackErrorEncountered(errorMessage: string, component?: string) {
  enqueue({
    event_type: 'error_encountered',
    page: currentPage,
    feature: component || undefined,
    detail: { message: errorMessage, component },
    timestamp: Date.now(),
  });
}

/**
 * Initialize the session tracker. Call once in root layout.
 */
export function initSessionTracker() {
  if (typeof window === 'undefined') return;

  sessionId = generateSessionId();
  sessionStartTime = Date.now();
  lastActivityTime = Date.now();

  // Track initial page view
  trackPageView(window.location.pathname);

  // Track session start
  enqueue({
    event_type: 'session_start',
    page: window.location.pathname,
    detail: {
      referrer: document.referrer || undefined,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
    },
    timestamp: Date.now(),
  });

  // Flush periodically
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  // Track visibility changes (tab switches)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      enqueue({
        event_type: 'tab_hidden',
        page: currentPage,
        timestamp: Date.now(),
      });
      flush(); // Flush immediately when tab goes hidden
    } else {
      enqueue({
        event_type: 'tab_visible',
        page: currentPage,
        timestamp: Date.now(),
      });
    }
  });

  // Track session end on unload
  window.addEventListener('beforeunload', () => {
    const duration = Math.round((Date.now() - sessionStartTime) / 1000);
    enqueue({
      event_type: 'session_end',
      page: currentPage,
      detail: { duration_seconds: duration },
      timestamp: Date.now(),
    });
    flush();
    if (flushTimer) clearInterval(flushTimer);
  });

  // Listen for SPA navigation via popstate
  window.addEventListener('popstate', () => {
    trackPageView(window.location.pathname);
  });

  // Monkey-patch pushState/replaceState for Next.js route changes
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    trackPageView(window.location.pathname);
  };

  history.replaceState = function (...args) {
    originalReplaceState(...args);
    // Don't track replaceState as page view (usually scroll restoration)
  };
}
