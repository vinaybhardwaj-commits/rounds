'use client';

// ============================================
// Rounds — /case/[id] route (Sprint 2 Day 6)
//
// Hosts the full-screen Shape C drawer. Thin wrapper around CaseDrawer in
// mode="drawer". The actual "drawer" UI is a panel; keeping the route simple
// means we can later wrap it in a sliding sidebar on the PatientDetailView
// without rewriting the drawer itself.
//
// Role is read from /api/auth/me so CaseDrawer can auto-expand the right
// track. If the fetch fails the drawer still renders with no auto-expansion.
//
// Auth gate: /api/cases/:id itself enforces auth + tenancy, so this page just
// needs to render something useful for the unauthenticated case (link to login)
// — but in practice, middleware already redirects anonymous users.
//
// Route: /case/:id
// Optional query: ?view=drawer (reserved for future; right now always drawer).
// ============================================

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CaseDrawer from '@/components/drawer/CaseDrawer';

interface MeResponse {
  success: boolean;
  // Shape from /api/auth/me → columns off `profiles`. Only `role` matters here.
  data?: { id: string; role: string; email: string; full_name?: string };
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((body: MeResponse | null) => {
        if (!cancelled && body?.success && body.data?.role) {
          setRole(body.data.role);
        }
      })
      .catch(() => {
        /* non-fatal — drawer just won't auto-expand a track */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!caseId) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-sm text-red-700">Missing case id in URL.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-5xl flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Back
        </button>
        <span className="text-gray-500">Case detail</span>
      </div>
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <CaseDrawer caseId={caseId} mode="drawer" role={role} onClose={() => router.back()} />
      </div>
    </main>
  );
}
