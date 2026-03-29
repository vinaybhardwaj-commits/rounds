// ============================================
// POST /api/admin/getstream/seed-channels
// Creates one GetStream channel per EHRC department
// plus cross-functional channels.
// Protected: super_admin only. Idempotent.
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getStreamServerClient } from '@/lib/getstream';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// Cross-functional channels to create alongside department channels
const CROSS_FUNCTIONAL_CHANNELS = [
  {
    id: 'ops-daily-huddle',
    name: 'Ops Daily Huddle',
    description: 'Morning ops meeting coordination across all departments',
  },
  {
    id: 'admission-coordination',
    name: 'Admission Coordination',
    description: 'Cross-department admission workflow',
  },
  {
    id: 'discharge-coordination',
    name: 'Discharge Coordination',
    description: 'Cross-department discharge workflow',
  },
  {
    id: 'surgery-coordination',
    name: 'Surgery Coordination',
    description: 'OT scheduling and surgery prep coordination',
  },
  {
    id: 'emergency-escalation',
    name: 'Emergency Escalation',
    description: 'Urgent cross-department escalations',
  },
];

// The hospital-wide ops broadcast channel
const OPS_BROADCAST = {
  id: 'hospital-broadcast',
  name: 'EHRC Broadcast',
  description: 'Hospital-wide operational announcements (read-only)',
};

/**
 * Ensure a channel exists and add a user as member.
 * Idempotent: works whether channel is new or already exists.
 */
async function ensureChannelWithMember(
  client: ReturnType<typeof getStreamServerClient>,
  type: string,
  id: string,
  data: Record<string, unknown>,
  memberId: string
): Promise<string> {
  let created = false;

  // Step 1: Ensure channel exists
  try {
    const channel = client.channel(type, id, {
      ...data,
      created_by_id: 'rounds-system',
    });
    await channel.create();
    created = true;
  } catch {
    // Channel likely already exists — that's fine
  }

  // Step 2: Always add member (separate call, works for both new and existing)
  try {
    const channel = client.channel(type, id);
    await channel.addMembers([memberId]);
  } catch {
    // Member may already be added — that's fine
  }

  const label = (data.name as string) || id;
  return created
    ? `Created: ${label}`
    : `Exists: ${label} — member added`;
}

export async function POST() {
  try {
    // Auth check — super_admin only
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 }
      );
    }

    const client = getStreamServerClient();
    const results: string[] = [];
    const callerUserId = user.profileId;

    // 1. Fetch all active departments from our DB
    const departments = await sql`
      SELECT id, name, slug FROM departments WHERE is_active = true ORDER BY name
    `;

    // 2. Create/ensure department channels
    for (const dept of departments) {
      const result = await ensureChannelWithMember(
        client,
        'department',
        dept.slug as string,
        {
          name: dept.name as string,
          description: `${dept.name} department channel`,
          department_id: dept.id as string,
        },
        callerUserId
      );
      results.push(`[dept] ${result}`);
    }

    // 3. Create/ensure cross-functional channels
    for (const cf of CROSS_FUNCTIONAL_CHANNELS) {
      const result = await ensureChannelWithMember(
        client,
        'cross-functional',
        cf.id,
        { name: cf.name, description: cf.description },
        callerUserId
      );
      results.push(`[cross] ${result}`);
    }

    // 4. Create/ensure ops broadcast channel
    const broadcastResult = await ensureChannelWithMember(
      client,
      'ops-broadcast',
      OPS_BROADCAST.id,
      { name: OPS_BROADCAST.name, description: OPS_BROADCAST.description },
      callerUserId
    );
    results.push(`[broadcast] ${broadcastResult}`);

    return NextResponse.json({
      success: true,
      data: {
        department_channels: departments.length,
        cross_functional_channels: CROSS_FUNCTIONAL_CHANNELS.length,
        broadcast_channels: 1,
        log: results,
      },
      message: `Seeded ${results.length} channels`,
    });
  } catch (error) {
    console.error('POST /api/admin/getstream/seed-channels error:', error);
    const message = error instanceof Error ? error.message : 'Channel seeding failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
