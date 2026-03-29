import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { generateStreamToken, syncUserToGetStream } from '@/lib/getstream';
import { ChatPage } from '@/components/chat/ChatPage';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  if (user.status !== 'active') {
    redirect('/auth/pending');
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
    <ChatPage
      userId={user.profileId}
      userRole={user.role}
      streamToken={streamToken}
    />
  );
}
