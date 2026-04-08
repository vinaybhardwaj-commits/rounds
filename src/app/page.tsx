import { redirect } from 'next/navigation';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { generateStreamToken, syncUserToGetStream } from '@/lib/getstream';
import { AppShell } from '@/components/AppShell';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  if (user.status !== 'active') {
    redirect('/auth/pending');
  }

  // Check if user must change their PIN (set by admin)
  // Wrapped in try/catch: column may not exist until migration v9 runs
  try {
    const sql = neon(process.env.POSTGRES_URL!);
    const pinCheck = await sql`SELECT must_change_pin FROM profiles WHERE id = ${user.profileId}`;
    if (pinCheck.length && (pinCheck[0] as Record<string, unknown>).must_change_pin) {
      redirect('/auth/change-pin');
    }
  } catch {
    // Column doesn't exist yet — skip check until migration runs
  }

  // Generate a stream token for the client
  let streamToken: string | null = null;
  try {
    // Fetch full profile for GetStream sync (use real name, not email prefix)
    const sql2 = neon(process.env.POSTGRES_URL!);
    const profileRows = await sql2`
      SELECT full_name, department_id FROM profiles WHERE id = ${user.profileId}
    `;
    const profile = profileRows[0] as Record<string, unknown> | undefined;

    // Ensure user exists in GetStream with correct profile data (idempotent)
    await syncUserToGetStream({
      id: user.profileId,
      name: (profile?.full_name as string) || user.email.split('@')[0],
      email: user.email,
      role: user.role,
      department_id: (profile?.department_id as string) || null,
    });
    streamToken = generateStreamToken(user.profileId);
  } catch (error) {
    console.error('Failed to generate stream token on page load:', error);
    // Chat will degrade gracefully — ChatProvider will try /api/auth/stream-token
  }

  return (
    <AppShell
      userId={user.profileId}
      userRole={user.role}
      streamToken={streamToken}
    />
  );
}
