'use client';

// =============================================================================
// FeatureFlagsProvider — client-side feature flag context
// 1 May 2026 (sub-sprint D.3)
//
// Wrapped into the root layout so every component tree can read flags via
// useFeatureFlag() / useOtPlanningEnabled(). Hydrates once at mount via
// GET /api/settings/flags. Refresh on demand (e.g. after the admin toggle
// flips a flag) via the refresh() function on the context.
//
// Defaults: all flags false. If the fetch fails (anonymous user → 401,
// network blip), the defaults stick so the UI behaves as if the feature
// is off — which matches V's "hide by default" intent for ot_planning.
// Server-side gates (e.g. /ot-management/layout.tsx) make the same
// decision independently using src/lib/feature-flags.ts so direct-URL
// navigation can't bypass the flag.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface FeatureFlags {
  ot_planning_enabled: boolean;
  pac_workspace_v2_enabled: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  ot_planning_enabled: false,
  pac_workspace_v2_enabled: false,
};

interface ContextValue {
  flags: FeatureFlags;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeatureFlagsContext = createContext<ContextValue>({
  flags: DEFAULT_FLAGS,
  loading: true,
  refresh: async () => {},
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/flags', { cache: 'no-store' });
      if (!res.ok) {
        // Anonymous (401) or transient — keep defaults.
        return;
      }
      const body = await res.json();
      if (body && body.success && body.data && typeof body.data === 'object') {
        // Merge over defaults so unknown keys are dropped and missing keys
        // fall back to the safe value (false).
        const next: FeatureFlags = { ...DEFAULT_FLAGS };
        for (const k of Object.keys(DEFAULT_FLAGS) as (keyof FeatureFlags)[]) {
          if (typeof body.data[k] === 'boolean') {
            next[k] = body.data[k];
          }
        }
        setFlags(next);
      }
    } catch {
      // Network failure — keep current state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): ContextValue {
  return useContext(FeatureFlagsContext);
}

export function useFeatureFlag(key: keyof FeatureFlags): boolean {
  const { flags } = useFeatureFlags();
  return flags[key] === true;
}

/** Convenience hook for the most-checked flag. Defaults to false (hidden). */
export function useOtPlanningEnabled(): boolean {
  return useFeatureFlag('ot_planning_enabled');
}

/** PCW2.4 — gates the v2 Smart Suggestions inbox in PACWorkspaceView. */
export function usePacWorkspaceV2Enabled(): boolean {
  return useFeatureFlag('pac_workspace_v2_enabled');
}
