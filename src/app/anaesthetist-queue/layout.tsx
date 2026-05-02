// /anaesthetist-queue — gated by ot_planning_enabled flag (sub-sprint D.3).
import { redirect } from 'next/navigation';
import { isOtPlanningEnabled } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

export default async function AnaesthetistQueueLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOtPlanningEnabled())) redirect('/');
  return <>{children}</>;
}
