// ============================================
// Error Reporter — lightweight client-side
// error tracking. Catches unhandled errors,
// promise rejections, and provides a manual
// reportError() function for try/catch blocks.
//
// Setup: call initErrorReporter() once in layout.
// ============================================

const ERROR_ENDPOINT = '/api/errors';
const QUEUE_FLUSH_MS = 2000;
const MAX_QUEUE = 10;

interface ErrorPayload {
  message: string;
  stack?: string;
  url?: string;
  component?: string;
  severity: 'error' | 'warning' | 'info';
  userAgent?: string;
  extra?: Record<string, unknown>;
}

// Dedupe: don't report the same error repeatedly in one session
const reportedErrors = new Set<string>();

let queue: ErrorPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(payload: ErrorPayload) {
  // Dedupe by message
  const key = `${payload.message}|${payload.component || ''}`;
  if (reportedErrors.has(key)) return;
  reportedErrors.add(key);

  queue.push(payload);

  // Flush when queue is full or after delay
  if (queue.length >= MAX_QUEUE) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, QUEUE_FLUSH_MS);
  }
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = queue.splice(0, MAX_QUEUE);
  if (batch.length === 0) return;

  // Send each error (simple — no batch endpoint needed for low volume)
  for (const payload of batch) {
    try {
      // Use sendBeacon if available (works during page unload)
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(
          ERROR_ENDPOINT,
          new Blob([JSON.stringify(payload)], { type: 'application/json' })
        );
      } else {
        fetch(ERROR_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {
          // Silently fail — error reporting should never break the app
        });
      }
    } catch {
      // Silently fail
    }
  }
}

/**
 * Report an error manually from a try/catch block.
 */
export function reportError(
  error: unknown,
  context?: { component?: string; severity?: 'error' | 'warning' | 'info'; extra?: Record<string, unknown> }
) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  enqueue({
    message,
    stack,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    component: context?.component,
    severity: context?.severity || 'error',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    extra: context?.extra,
  });
}

/**
 * Initialize global error handlers. Call once in the root layout.
 */
export function initErrorReporter() {
  if (typeof window === 'undefined') return;

  // Catch unhandled errors
  window.addEventListener('error', (event) => {
    // Skip cross-origin script errors (no useful info)
    if (event.message === 'Script error.' && !event.filename) return;

    enqueue({
      message: event.message || 'Unknown error',
      stack: event.error?.stack,
      url: event.filename || window.location.href,
      severity: 'error',
      userAgent: navigator.userAgent,
      extra: {
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
    const stack = reason instanceof Error ? reason.stack : undefined;

    enqueue({
      message,
      stack,
      url: window.location.href,
      severity: 'error',
      userAgent: navigator.userAgent,
      extra: { type: 'unhandledrejection' },
    });
  });

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    flush();
  });
}
