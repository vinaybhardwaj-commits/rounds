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
  const sql = neon(process.env.POSTGRES_URL!);
  const pinCheck = await sql`SELECT must_change_pin FROM profiles WHERE id = ${user.profileId}`;
  if (pinCheck.length && (pinCheck[0] as Record<string, unknown>).must_change_pin) {
    redirect('/auth/change-pin');
  }

  // Generate a stream token for the client
  let streamToken: string | null = null;
  try {
    // Ensure user exists in GetStream (idempotent)
    await syncUserToGetStream({
      id: user.profileId,
      name: user.email.split('@')[0], // fallback name from email
      email: user.email,
      role: user.role,
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
