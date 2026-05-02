// =============================================================================
// /admin/* layout — server-side super_admin gate
// 1 May 2026 (sub-sprint D.2)
//
// V's request: "the admin module and all its functions, new and old, should
// only be shown to superusers." Previously each admin page relied on its
// API endpoints enforcing role + the sidebar filter hiding items by
// `requiresRole`, but the page shells themselves were reachable by direct
// URL navigation for any logged-in user (they'd just see empty content
// because the API would return 403). This layout redirects non-super_admin
// users to / so the admin module is fully invisible at the routing layer.
//
// Children include all /admin/* pages. Logged-out users go to /login.
// Logged-in non-super_admins go to / (the default home).
// =============================================================================
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'super_admin') {
    redirect('/');
  }
  return <>{children}</>;
}
