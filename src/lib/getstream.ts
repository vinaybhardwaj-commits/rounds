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

/**
 * Create a patient-thread channel in GetStream with custom data.
 * Returns the channel ID (used to store in DB).
 */
export async function createPatientChannel(input: {
  patientThreadId: string;
  patientName: string;
  uhid?: string | null;
  currentStage: string;
  departmentId?: string | null;
  createdById: string;
  memberIds: string[];
}): Promise<string> {
  const client = getStreamServerClient();
  const channelId = `pt-${input.patientThreadId.slice(0, 8)}`;

  const channel = client.channel('patient-thread', channelId, {
    name: input.patientName,
    description: `Patient thread for ${input.patientName}${input.uhid ? ` (UHID: ${input.uhid})` : ''}`,
    created_by_id: input.createdById,
    // Custom data for the channel
    patient_thread_id: input.patientThreadId,
    patient_name: input.patientName,
    uhid: input.uhid || null,
    current_stage: input.currentStage,
    department_id: input.departmentId || null,
    members: [input.createdById, ...input.memberIds],
  });

  await channel.create();
  return channelId;
}

/**
 * Update a patient channel's custom data (e.g., on stage transition).
 */
export async function updatePatientChannel(
  channelId: string,
  data: Record<string, unknown>
): Promise<void> {
  const client = getStreamServerClient();
  const channel = client.channel('patient-thread', channelId);
  await channel.updatePartial({ set: data });
}

/**
 * Add multiple users to a channel at once.
 */
export async function addUsersToChannel(
  channelType: string,
  channelId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.addMembers(userIds);
}

/**
 * Send a shift handoff notification to a department channel.
 * Posts a system message with on-duty info for the current shift.
 */
export async function sendShiftHandoffMessage(
  departmentSlug: string,
  staffName: string,
  role: string,
  shiftType: string,
  shiftStart: string | null,
  shiftEnd: string | null
): Promise<void> {
  const roleLabel = role.replace(/_/g, ' ');
  const timeStr = shiftStart && shiftEnd ? ` (${shiftStart}–${shiftEnd})` : '';
  const shiftLabel = shiftType.replace(/_/g, ' ');

  await sendSystemMessage(
    'department',
    departmentSlug,
    `🔔 Shift Handoff: ${staffName} is now on duty as ${roleLabel} — ${shiftLabel} shift${timeStr}`
  );
}

/**
 * Auto-join a user to their default channels on login:
 * 1. Their department channel (if department_slug provided)
 * 2. The hospital-broadcast channel
 * 3. ALL cross-functional channels (everyone needs coordination visibility)
 * 4. ALL patient-thread channels (full transparency across hospital)
 *
 * Idempotent: silently succeeds if user is already a member.
 */
export async function autoJoinDefaultChannels(
  userId: string,
  departmentSlug?: string | null,
  role?: string | null
): Promise<void> {
  const client = getStreamServerClient();
  const isSuperAdmin = role === 'super_admin';

  // v1.1 (28 Apr 2026) — Auto-join to legacy 'hospital-broadcast' RETIRED.
  // Per-hospital broadcast channels (broadcast-{slug}) handle membership at
  // seed-channels time based on each user's primary_hospital_id. Existing
  // members of the legacy channel keep access; new users are no longer added.
  // The legacy channel still exists in GetStream and is reachable for any
  // queryChannels({type:'ops-broadcast'}) caller, but ChannelSidebar no longer
  // renders a row for it (see ChannelSidebar.tsx orderedTypes).

  // Super admins join ALL department channels; regular staff join only their own
  if (isSuperAdmin) {
    try {
      const deptChannels = await client.queryChannels(
        { type: 'department' },
        { last_message_at: -1 },
        { limit: 50 }
      );
      for (const ch of deptChannels) {
        try {
          await ch.addMembers([userId]);
        } catch {
          // Non-fatal per channel
        }
      }
    } catch {
      // Query failed — non-fatal
    }
  } else if (departmentSlug) {
    try {
      const deptChannel = client.channel('department', departmentSlug);
      await deptChannel.addMembers([userId]);
    } catch {
      // Channel may not exist yet or user already a member — fine
    }
  }

  // Join WhatsApp Insights channel (visible to all users)
  try {
    const waInsights = client.channel('whatsapp-analysis', 'whatsapp-insights');
    await waInsights.addMembers([userId]);
  } catch {
    // Channel may not exist yet — fine
  }

  // Join ALL cross-functional channels
  const crossFunctionalIds = [
    'ops-daily-huddle',
    'admission-coordination',
    'discharge-coordination',
    'surgery-coordination',
    'emergency-escalation',
  ];
  for (const cfId of crossFunctionalIds) {
    try {
      const ch = client.channel('cross-functional', cfId);
      await ch.addMembers([userId]);
    } catch {
      // Channel may not exist — fine
    }
  }

  // Join ALL patient-thread channels (query and bulk-add)
  try {
    const patientChannels = await client.queryChannels(
      { type: 'patient-thread' },
      { last_message_at: -1 },
      { limit: 200 }
    );
    for (const ch of patientChannels) {
      const members = Object.keys(ch.state?.members || {});
      if (!members.includes(userId)) {
        try {
          await ch.addMembers([userId]);
        } catch {
          // Non-fatal per channel
        }
      }
    }
  } catch {
    // Query failed — non-fatal, user will see channels they're already in
  }
}

// =============================================================================
// PAC Coordinator Workspace v1 — channel provisioning (PCW.1, PRD Q3 + §6.3)
//
// One channel per surgical_case, type 'pac-workspace'. Lazily created on first
// workspace open. Members = ipc_owner + anaesthetist + super_admins (for
// observability). Other roles can be added later via D2 role gating.
//
// Returns the channel id (always); throws only on credential/network failure
// — caller is responsible for swallowing best-effort errors.
// =============================================================================

export interface PacWorkspaceChannelInput {
  caseId: string;
  hospitalId: string;
  patientName: string | null;
  uhid: string | null;
  ipcOwnerId: string | null;
  anaesthetistId: string | null;
  initiatorId: string;
  extraMemberIds?: string[];
}

export async function ensurePacWorkspaceChannel(input: PacWorkspaceChannelInput): Promise<string> {
  const client = getStreamServerClient();
  const channelId = `pacw-${input.caseId.slice(0, 18)}`;
  const memberIds = Array.from(
    new Set(
      [input.initiatorId, input.ipcOwnerId, input.anaesthetistId, ...(input.extraMemberIds || [])]
        .filter((x): x is string => !!x),
    ),
  );

  const channel = client.channel('pac-workspace', channelId, {
    name: input.patientName || 'PAC Workspace',
    description: input.uhid ? `PAC workspace for ${input.patientName ?? ''} (UHID ${input.uhid})` : 'PAC workspace',
    created_by_id: input.initiatorId,
    case_id: input.caseId,
    hospital_id: input.hospitalId,
    patient_name: input.patientName,
    uhid: input.uhid,
    members: memberIds,
  });

  // create() is idempotent for existing channels — returns existing config.
  await channel.create();
  return channelId;
}
