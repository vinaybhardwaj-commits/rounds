'use client';

import { useEffect } from 'react';
import { initErrorReporter } from '@/lib/error-reporter';
import { initSessionTracker } from '@/lib/session-tracker';

/**
 * Initializes global error reporter + session analytics on mount.
 * Place once in root layout. Renders nothing.
 */
export function ErrorReporterInit() {
  useEffect(() => {
    initErrorReporter();
    initSessionTracker();
  }, []);

  return null;
}
