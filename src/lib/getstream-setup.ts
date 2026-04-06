// ============================================
// Rounds — GetStream One-Time Setup
// Run once via /api/admin/getstream/setup
// Creates: channel types, system bot user
// ============================================

import { getStreamServerClient } from './getstream';

/**
 * Channel type definitions for Rounds.
 * Each maps to a different communication pattern.
 *
 * - messaging: GetStream's built-in type, good base for most channels
 * - We create custom channel types for specific behaviors
 */
const CHANNEL_TYPE_CONFIGS = [
  {
    name: 'department',
    description: 'Department-level group channels (one per EHRC dept)',
    config: {
      max_message_length: 5000,
      typing_events: true,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: true, // thread replies
      quotes: true,
      uploads: true,
      url_enrichment: true,
      custom_events: true, // for readiness card updates
      mutes: true,
      message_retention: '365', // 1 year retention
      automod: 'disabled', // hospital internal — no automod
    },
  },
  {
    name: 'cross-functional',
    description: 'Cross-department coordination channels',
    config: {
      max_message_length: 5000,
      typing_events: true,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: true,
      quotes: true,
      uploads: true,
      url_enrichment: true,
      custom_events: true,
      mutes: true,
      message_retention: '365',
      automod: 'disabled',
    },
  },
  {
    name: 'patient-thread',
    description: 'Per-patient coordination threads (created on admission)',
    config: {
      max_message_length: 5000,
      typing_events: true,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: true,
      quotes: true,
      uploads: true,
      url_enrichment: true,
      custom_events: true, // readiness updates, stage changes
      mutes: false, // patient threads should not be mutable
      message_retention: '365',
      automod: 'disabled',
    },
  },
  {
    name: 'direct',
    description: 'Direct messages between two staff members',
    config: {
      max_message_length: 5000,
      typing_events: true,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: true,
      quotes: true,
      uploads: true,
      url_enrichment: true,
      custom_events: false,
      mutes: true,
      message_retention: '365',
      automod: 'disabled',
    },
  },
  {
    name: 'ops-broadcast',
    description: 'Hospital-wide operational broadcast (read-only for most users)',
    config: {
      max_message_length: 5000,
      typing_events: false,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: false, // broadcast — no replies
      quotes: false,
      uploads: true,
      url_enrichment: true,
      custom_events: true,
      mutes: true,
      message_retention: '365',
      automod: 'disabled',
    },
  },
  {
    name: 'whatsapp-analysis',
    description: 'WhatsApp chat analysis thread — upload exports, view AI analysis, discuss findings',
    config: {
      max_message_length: 10000, // analysis cards can be large
      typing_events: true,
      read_events: true,
      connect_events: true,
      search: true,
      reactions: true,
      replies: true, // threaded discussion on analysis results
      quotes: true,
      uploads: true, // .txt file uploads
      url_enrichment: false, // no URL previews needed
      custom_events: true, // for analysis progress updates
      mutes: true,
      message_retention: '365',
      automod: 'disabled',
    },
  },
];

/**
 * Create all custom channel types in GetStream.
 * Idempotent — safe to run multiple times (updateChannelType if exists).
 */
async function setupChannelTypes(): Promise<string[]> {
  const client = getStreamServerClient();
  const results: string[] = [];

  // Get existing channel types to know which to create vs update
  const { channel_types: existingTypes } = await client.listChannelTypes();
  const existingNames = new Set(Object.keys(existingTypes || {}));

  for (const ct of CHANNEL_TYPE_CONFIGS) {
    try {
      if (existingNames.has(ct.name)) {
        await client.updateChannelType(ct.name, ct.config);
        results.push(`Updated channel type: ${ct.name}`);
      } else {
        await client.createChannelType({
          name: ct.name,
          ...ct.config,
        });
        results.push(`Created channel type: ${ct.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(`Error with channel type ${ct.name}: ${message}`);
    }
  }

  return results;
}

/**
 * Create the system bot user (rounds-system).
 * Used for cascade messages, system notifications, escalation alerts.
 */
async function setupSystemBot(): Promise<string> {
  const client = getStreamServerClient();

  try {
    await client.upsertUser({
      id: 'rounds-system',
      name: 'Rounds System',
      role: 'admin', // needs to post to any channel
      image: 'https://ui-avatars.com/api/?name=R&background=0055FF&color=fff&size=128&bold=true&format=png',
      is_bot: true,
    });
    return 'System bot user created/updated: rounds-system';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error creating system bot: ${message}`;
  }
}

/**
 * Run the full GetStream setup. Called from /api/admin/getstream/setup.
 * Returns a log of what was created/updated.
 */
export async function runGetStreamSetup(): Promise<{
  channelTypes: string[];
  systemBot: string;
}> {
  const channelTypes = await setupChannelTypes();
  const systemBot = await setupSystemBot();

  return { channelTypes, systemBot };
}
