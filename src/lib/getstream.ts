// ============================================
// Rounds — GetStream Server-Side Client
// Handles: client init, user token generation,
//          user upsert, channel operations
// ============================================

import { StreamChat } from 'stream-chat';

// --- Lazy singleton (serverless-safe) ---
let _serverClient: StreamChat | null = null;

/**
 * Returns the server-side StreamChat client (admin privileges).
 * Uses lazy init to work in serverless environments.
 */
export function getStreamServerClient(): StreamChat {
  if (_serverClient) return _serverClient;

  const apiKey = process.env.NEXT_PUBLIC_GETSTREAM_API_KEY;
  const apiSecret = process.env.GETSTREAM_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Missing GetStream credentials. Set NEXT_PUBLIC_GETSTREAM_API_KEY and GETSTREAM_API_SECRET.'
    );
  }

  _serverClient = StreamChat.getInstance(apiKey, apiSecret);
  return _serverClient;
}

// --- Token Generation ---

/**
 * Generate a GetStream user token for the given profile.
 * Called during login to bridge our custom JWT auth → GetStream auth.
 *
 * @param profileId  Our internal profile UUID (becomes GetStream user ID)
 * @param expiresIn  Token validity in seconds (default: 24h, refreshed on app open)
 */
export function generateStreamToken(
  profileId: string,
  expiresIn: number = 60 * 60 * 24 // 24 hours
): string {
  const client = getStreamServerClient();
  // GetStream user IDs can't have certain chars — UUIDs are safe
  return client.createToken(profileId, Math.floor(Date.now() / 1000) + expiresIn);
}

// --- User Sync ---

/**
 * Upsert a user in GetStream. Called on login and profile updates.
 * Maps our Profile → GetStream User with custom fields.
 */
export async function syncUserToGetStream(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  department_id?: string | null;
  image?: string | null;
}): Promise<void> {
  const client = getStreamServerClient();
  await client.upsertUser({
    id: user.id,
    name: user.name,
    email: user.email,
    role: 'user', // GetStream role (not our app role)
    image: user.image || undefined,
    // Custom fields stored on the GetStream user
    rounds_role: user.role,
    department_id: user.department_id || undefined,
  });
}

// --- Channel Helpers ---

/**
 * Add a user to a GetStream channel.
 */
export async function addUserToChannel(
  channelType: string,
  channelId: string,
  userId: string
): Promise<void> {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.addMembers([userId]);
}

/**
 * Remove a user from a GetStream channel.
 */
export async function removeUserFromChannel(
  channelType: string,
  channelId: string,
  userId: string
): Promise<void> {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.removeMembers([userId]);
}

/**
 * Send a system/bot message to a channel (used by cascade engine).
 */
export async function sendSystemMessage(
  channelType: string,
  channelId: string,
  text: string,
  extraData?: Record<string, unknown>
): Promise<void> {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);

  await channel.sendMessage({
    text,
    user_id: 'rounds-system',
    ...extraData,
  });
}
