'use client';

// =============================================================================
// OTManagementView — OT Management Module v1 shell (OT.1, 28 Apr 2026)
//
// PRD: Daily Dash EHRC/OT-MANAGEMENT-MODULE-PRD.md (v1.1 LOCKED 28 Apr 2026)
//
// OT.1 ships the SHELL only — hospital tabs + sticky pin banner placeholder
// + 7 placeholder section blocks. Real content arrives in OT.2 (slate +
// booking inbox + PAC queue), OT.3 (equipment + KPIs + notes), OT.4 (live
// updates + patient pre-load + entry-point URL updates + /ot-calendar
// fold-in + 308 redirect).
//
// Glass mode: visible to every signed-in user (PRD D2). Action endpoints
// keep their own role gates; this shell does no role-gating itself.
//
// Hospital tabs: PRD D3. Tabs are user_accessible_hospital_ids; default
// active tab = primary_hospital_slug from /api/auth/me.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CalendarRange,
  ClipboardList,
  Inbox,
  Activity,
  Wrench,
  BarChart3,
  StickyNote,
  Loader2,
} from 'lucide-react';

interface AccessibleHospital {
  id: string;
  slug: string;
  name: string;
  ot_room_count: number;
}

interface OTManagementViewProps {
  userRole?: string;
  userId?: string;
}

// PRD D3 default fallback if /api/auth/me hasn't resolved yet (matches PTR.8 pattern)
const DEFAULT_HOSPITAL_SLUG = 'ehrc';

export function OTManagementView(_props: OTManagementViewProps) {
  const searchParams = useSearchParams();
  const patientIdFromUrl = searchParams.get('patient_id') || searchParams.get('patient'); // tolerate both during OT.4 transition

  const [hospitals, setHospitals] = useState<AccessibleHospital[]>([]);
  const [primarySlug, setPrimarySlug] = useState<string>(DEFAULT_HOSPITAL_SLUG);
  const [activeSlug, setActiveSlug] = useState<string>(DEFAULT_HOSPITAL_SLUG);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Fetch primary_hospital_slug + accessible hospitals on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/hospitals/accessible').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meBody, hospBody]) => {
        if (cancelled) return;
        const slug = meBody?.data?.primary_hospital_slug as string | undefined;
        const list = (hospBody?.data as AccessibleHospital[] | undefined) || [];
        if (slug && slug.length > 0) {
          setPrimarySlug(slug);
          setActiveSlug(slug);
        }
        setHospitals(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load OT module');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeHospital = useMemo(
    () => hospitals.find((h) => h.slug === activeSlug) || null,
    [hospitals, activeSlug]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={20} />
        <span className="ml-2 text-sm">Loading OT Management…</span>
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex h-full items-center justify-center text-red-500 px-6 text-center">
        <AlertCircle size={20} className="mr-2 flex-shrink-0" />
        <span className="text-sm">{err}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Hospital tabs (sticky) */}
      <div className="bg-white border-b border-gray-200 px-3 pt-2 sticky top-0 z-10">
        <div className="flex items-center gap-1 overflow-x-auto">
          {hospitals.length === 0 ? (
            <span className="text-xs text-gray-400 px-2 py-1">No accessible hospitals.</span>
          ) : (
            hospitals.map((h) => {
              const isActive = h.slug === activeSlug;
              const isPrimary = h.slug === primarySlug;
              return (
                <button
                  key={h.id}
                  onClick={() => setActiveSlug(h.slug)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                    isActive
                      ? 'border-even-blue text-even-blue bg-blue-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {h.slug.toUpperCase()}
                  {isPrimary && (
                    <span className="ml-1.5 text-[10px] text-gray-400 font-normal">primary</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Sticky patient pin banner placeholder (OT.4 will fill this in) */}
      {patientIdFromUrl && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 sticky top-[37px] z-10 flex items-center gap-2 text-sm">
          <ClipboardList size={14} className="text-amber-600 flex-shrink-0" />
          <span className="text-amber-800">
            Patient pre-load <code className="text-xs bg-amber-100 px-1 rounded">{patientIdFromUrl}</code> — pin banner + auto-scroll arrives in OT.4.
          </span>
        </div>
      )}

      {/* Sections (single scrolling page per PRD D5) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <SectionPlaceholder
            icon={ClipboardList}
            title={`Today's slate — ${activeHospital?.name || activeSlug.toUpperCase()}`}
            subtitle="OT.2 will render scheduled cases for today with surgeon · anaesthetist · room · readiness chip."
          />
          <SectionPlaceholder
            icon={Inbox}
            title="Booking inbox"
            subtitle="OT.2 will render PAC-cleared, OT-fit patients without a slot. Sort: urgency DESC → PAC-date ASC."
          />
          <SectionPlaceholder
            icon={Activity}
            title="PAC queue"
            subtitle="OT.2 will render fit_conds · optimizing · pac_scheduled · defer · unfit (5 states, glass-visible flat with state grouping)."
          />
          <SectionPlaceholder
            icon={CalendarRange}
            title="Week view"
            subtitle="OT.4 folds /ot-calendar contents into this tab. Until then, open the standalone calendar →"
            cta={{ label: 'Open OT Calendar', href: '/ot-calendar' }}
          />
          <SectionPlaceholder
            icon={Wrench}
            title="Equipment / vendor calls"
            subtitle="OT.3 will render today + tomorrow + currently-blocked equipment items."
          />
          <SectionPlaceholder
            icon={BarChart3}
            title="KPIs · yesterday"
            subtitle="OT.3 will render utilization % · on-time first-case % · equipment-blocked cancellations 7d · avg PAC-to-OT lag."
          />
          <SectionPlaceholder
            icon={StickyNote}
            title="Coordinator notes"
            subtitle="OT.3 will render the per-hospital persistent notepad with edit + see-history modal."
          />
        </div>
      </div>
    </div>
  );
}

interface SectionPlaceholderProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  cta?: { label: string; href: string };
}

function SectionPlaceholder({ icon: Icon, title, subtitle, cta }: SectionPlaceholderProps) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <header className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </header>
      <p className="text-xs text-gray-500">{subtitle}</p>
      {cta && (
        <a
          href={cta.href}
          className="inline-block mt-2 text-xs text-even-blue font-medium hover:underline"
        >
          {cta.label} →
        </a>
      )}
    </section>
  );
}
