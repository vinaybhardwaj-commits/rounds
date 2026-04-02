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
  {
    id: 'ot-schedule',
    name: 'OT Schedule',
    description: 'Surgery posting notifications, readiness updates, and daily OT digest',
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
    ` as Record<string, unknown>[];

    // Fetch all active staff grouped by department (include role for super_admin detection)
    const allStaff = await sql`
      SELECT id, department_id, role FROM profiles WHERE status = 'active'
    ` as Record<string, unknown>[];

    // Build department → member IDs map
    const deptMembers: Record<string, string[]> = {};
    const allStaffIds: string[] = [];
    const superAdminIds: string[] = [];
    for (const s of allStaff) {
      const pid = s.id as string;
      allStaffIds.push(pid);
      if (s.role === 'super_admin') {
        superAdminIds.push(pid);
      }
      if (s.department_id) {
        const did = s.department_id as string;
        if (!deptMembers[did]) deptMembers[did] = [];
        deptMembers[did].push(pid);
      }
    }

    // 2. Create/ensure department channels + add ALL department staff
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

      // Add all staff assigned to this department + super_admins (they see everything)
      const deptStaff = deptMembers[dept.id as string] || [];
      const memberSet = new Set([...deptStaff, ...superAdminIds]);
      const memberIds = Array.from(memberSet);
      if (memberIds.length > 0) {
        try {
          const channel = client.channel('department', dept.slug as string);
          // Batch add in groups of 100
          for (let i = 0; i < memberIds.length; i += 100) {
            const batch = memberIds.slice(i, i + 100);
            await channel.addMembers(batch);
          }
        } catch {
          // Non-fatal — members may already exist
        }
      }

      results.push(`[dept] ${result} (${deptStaff.length} dept staff + ${superAdminIds.length} admins)`);
    }

    // 3. Create/ensure cross-functional channels + add ALL active staff
    for (const cf of CROSS_FUNCTIONAL_CHANNELS) {
      const result = await ensureChannelWithMember(
        client,
        'cross-functional',
        cf.id,
        { name: cf.name, description: cf.description },
        callerUserId
      );

      // Add all active staff to cross-functional channels
      if (allStaffIds.length > 0) {
        try {
          const channel = client.channel('cross-functional', cf.id);
          for (let i = 0; i < allStaffIds.length; i += 100) {
            const batch = allStaffIds.slice(i, i + 100);
            await channel.addMembers(batch);
          }
        } catch {
          // Non-fatal
        }
      }

      results.push(`[cross] ${result} (${allStaffIds.length} staff)`);
    }

    // 4. Create/ensure ops broadcast channel + add ALL active staff
    const broadcastResult = await ensureChannelWithMember(
      client,
      'ops-broadcast',
      OPS_BROADCAST.id,
      { name: OPS_BROADCAST.name, description: OPS_BROADCAST.description },
      callerUserId
    );

    if (allStaffIds.length > 0) {
      try {
        const channel = client.channel('ops-broadcast', OPS_BROADCAST.id);
        for (let i = 0; i < allStaffIds.length; i += 100) {
          const batch = allStaffIds.slice(i, i + 100);
          await channel.addMembers(batch);
        }
      } catch {
        // Non-fatal
      }
    }

    results.push(`[broadcast] ${broadcastResult} (${allStaffIds.length} staff)`);

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
