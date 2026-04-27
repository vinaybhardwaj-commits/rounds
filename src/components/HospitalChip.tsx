'use client';

// =============================================================================
// HospitalChip — color-coded badge for hospital_id on list views
//
// Per Multi-Hospital v2 PRD §7.2 + gap analysis §3.3 — closes the
// "I don't know which hospital this is for" P1 visible across patient lists,
// case lists, form submissions, equipment kanban, etc.
//
// USAGE
//   <HospitalChip hospitalId={patient.hospital_id} hospitalSlug={patient.hospital_slug} hospitalName={patient.hospital_name} />
//
//   Or with just slug (lightest):
//   <HospitalChip hospitalSlug="ehrc" />
//
// COLORS
//   ehrc → blue   (primary EHRC hospital, current home)
//   ehbr → green  (Bangalore Brookefield)
//   ehin → amber  (Indiranagar — under construction; chip rendered but
//                  desaturated to signal not-yet-active)
//   other → gray  (fallback for unknown/inactive)
// =============================================================================

interface HospitalChipProps {
  hospitalSlug?: string | null;
  hospitalShortName?: string | null;
  hospitalName?: string | null;
  /** Show only the short code (3-4 chars) instead of name. Default: true (compact). */
  short?: boolean;
  className?: string;
}

const COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  ehrc: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'EHRC' },
  ehbr: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'EHBR' },
  ehin: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'EHIN' },
};

const FALLBACK = { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: '—' };

export function HospitalChip({
  hospitalSlug,
  hospitalShortName,
  hospitalName,
  short = true,
  className = '',
}: HospitalChipProps) {
  const slug = (hospitalSlug || '').toLowerCase();
  const palette = COLORS[slug] || FALLBACK;
  const display = short
    ? (hospitalShortName || palette.label)
    : (hospitalName || palette.label);
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${palette.bg} ${palette.text} ${palette.border} ${className}`}
      title={hospitalName || palette.label}
    >
      {display}
    </span>
  );
}

/**
 * Companion: scope chip for user cards in /admin/users (and /profile).
 * Shows whether a user is hospital_bound, multi_hospital, or central.
 */
interface ScopeChipProps {
  roleScope: 'hospital_bound' | 'multi_hospital' | 'central' | string;
  className?: string;
}

const SCOPE_PALETTE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  hospital_bound: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', label: 'Hospital-bound' },
  multi_hospital: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', label: 'Multi-hospital' },
  central: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', label: 'Central' },
};

export function ScopeChip({ roleScope, className = '' }: ScopeChipProps) {
  const palette = SCOPE_PALETTE[roleScope] || { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: roleScope };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${palette.bg} ${palette.text} ${palette.border} ${className}`}
    >
      {palette.label}
    </span>
  );
}
