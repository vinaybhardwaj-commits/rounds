// =============================================================================
// PAC Workspace v2 — Resolution state helper (PCW2.10)
//
// Two-axis lifecycle per PRD §11. Single column resolution_state on
// pac_workspace_progress; helpers map it to (editable, locked, label, color).
//
// Carve-outs per PRD §11.x: day-of checklist items + anaesthetist re-publish
// + post-publish add-item are still allowed even when the workspace is
// otherwise read-only. PCW2.11 wires the publish gate; PCW2.10 just signals.
// =============================================================================

export type ResolutionState =
  | 'none'
  | 'active_for_surgery'
  | 'active_for_optimization'
  | 'completed'
  | 'cancelled'
  | 'superseded'
  | null
  | undefined;

export interface ResolutionStateMeta {
  state: ResolutionState;
  label: string;
  /** When false, coordinator writes are blocked except for day-of carve-outs. */
  editable: boolean;
  /** When true, every UI surface should refuse mutation (terminal states). */
  locked: boolean;
  /**
   * 'none' rendering means the banner is HIDDEN — no surgery yet, no signal
   * to surface. Other states render an info / warning / locked banner.
   */
  bannerStyle: 'hidden' | 'info' | 'warning' | 'locked';
  description: string;
}

const META_BY_STATE: Record<NonNullable<ResolutionState>, ResolutionStateMeta> = {
  none: {
    state: 'none',
    label: 'In flight',
    editable: true,
    locked: false,
    bannerStyle: 'hidden',
    description:
      'Workspace is editable. Anaesthetist publish has not been declared.',
  },
  active_for_surgery: {
    state: 'active_for_surgery',
    label: 'Active for surgery',
    editable: false,
    locked: false,
    bannerStyle: 'info',
    description:
      'Anaesthetist has published FIT. Workspace is read-only except for day-of checklist items + anaesthetist re-publish.',
  },
  active_for_optimization: {
    state: 'active_for_optimization',
    label: 'Active for optimisation',
    editable: true,
    locked: false,
    bannerStyle: 'warning',
    description:
      'Anaesthetist has DEFERRED. Coordinator continues optimisation; re-publish required after gates clear.',
  },
  completed: {
    state: 'completed',
    label: 'Completed',
    editable: false,
    locked: true,
    bannerStyle: 'locked',
    description:
      'Surgery completed. Workspace is frozen for audit; no further edits.',
  },
  cancelled: {
    state: 'cancelled',
    label: 'Cancelled',
    editable: false,
    locked: true,
    bannerStyle: 'locked',
    description:
      'Case cancelled. Workspace is frozen.',
  },
  superseded: {
    state: 'superseded',
    label: 'Superseded',
    editable: false,
    locked: true,
    bannerStyle: 'locked',
    description:
      'A newer workspace has replaced this one. Frozen for audit.',
  },
};

export function getResolutionStateMeta(s: ResolutionState): ResolutionStateMeta {
  if (s == null) return META_BY_STATE.none;
  return META_BY_STATE[s] ?? META_BY_STATE.none;
}

/** True when coordinator writes (accept / skip / already-done / schedule /
 * result entry / ASA override) should be allowed. False when read-only or
 * locked. Day-of carve-outs handled by callers checking `isLocked` separately. */
export function isCoordinatorWriteAllowed(s: ResolutionState): boolean {
  return getResolutionStateMeta(s).editable;
}

/** True when this is a terminal state (completed / cancelled / superseded).
 * Used by callers to refuse anaesthetist re-publish in addition to
 * coordinator writes. */
export function isLocked(s: ResolutionState): boolean {
  return getResolutionStateMeta(s).locked;
}
