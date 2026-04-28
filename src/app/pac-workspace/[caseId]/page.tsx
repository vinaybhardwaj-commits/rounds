// =============================================================================
// /pac-workspace/[caseId] — PCW.1 standalone workspace page
//
// Server component shell. Renders the AppShell-less full-screen workspace UI.
// Why no AppShell: the workspace is a focused, single-purpose surface; the
// bottom-tab bar would compete with the workspace's own actions. A "Back to
// OT module" link lives in the workspace header.
// =============================================================================

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PACWorkspaceView } from '@/components/pac-workspace/PACWorkspaceView';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function PACWorkspacePage({
  params,
}: {
  params: { caseId: string };
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirect=/pac-workspace/${encodeURIComponent(params.caseId)}`);
  }

  if (!UUID_RE.test(params.caseId)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Invalid workspace URL</h1>
          <p className="mt-2 text-sm text-gray-600">
            The case id in the URL is not a valid UUID. If you arrived here from a link, please return to the OT module
            and reopen the patient.
          </p>
          <a
            href="/?tab=ot"
            className="mt-4 inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            ← Back to OT module
          </a>
        </div>
      </main>
    );
  }

  return <PACWorkspaceView caseId={params.caseId} userRole={user.role} />;
}
