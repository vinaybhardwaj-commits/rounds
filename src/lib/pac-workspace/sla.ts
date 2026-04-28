// =============================================================================
// PAC Coordinator Workspace v1 — SLA computation
// PRD Q7 + SOP §6.1: SLA derives from surgical_cases.urgency (NCEPOD).
//
//   IMMEDIATE       → 30 minutes
//   URGENT          → 2 to 4 hours (we use 4 to be conservative)
//   SEMI-EMERGENCY  → 24 hours
//   ELECTIVE        → 48 hours (proxy for "before OT list")
//
// PCW.4 surfaces this as a chip color on the PAC queue row.
// =============================================================================

const SLA_HOURS_BY_URGENCY: Record<string, number> = {
  immediate: 0.5,
  urgent: 4,
  semi_emergency: 24,
  elective: 48,
};

export function computeSLADeadline(
  urgency: string | null,
  fromIso: string | null = null,
): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  const hours = SLA_HOURS_BY_URGENCY[(urgency || 'elective').toLowerCase()] ?? 48;
  const deadline = new Date(base.getTime() + hours * 3_600_000);
  return deadline.toISOString();
}
