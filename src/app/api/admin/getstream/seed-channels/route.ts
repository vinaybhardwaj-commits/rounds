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
    const callerUserId = user.id; // Add the calling admin to all channels

    // 1. Fetch all active departments from our DB
    const departments = await sql`
      SELECT id, name, slug FROM departments WHERE is_active = true ORDER BY name
    `;

    // 2. Create a department channel for each
    for (const dept of departments) {
      try {
        const channel = client.channel('department', dept.slug as string, {
          name: dept.name as string,
          description: `${dept.name} department channel`,
          created_by_id: 'rounds-system',
          // Custom data linking back to our DB
          department_id: dept.id as string,
        });
        await channel.create();
        await channel.addMembers([callerUserId]);
        results.push(`Department channel: ${dept.name} (${dept.slug})`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // "already exists" is fine — idempotent. Still add the caller as member.
        if (msg.includes('already exists') || msg.includes('already_exists')) {
          try {
            const existing = client.channel('department', dept.slug as string);
            await existing.addMembers([callerUserId]);
          } catch { /* member may already be added */ }
          results.push(`Department channel exists: ${dept.name} (${dept.slug}) — member added`);
        } else {
          results.push(`Error creating ${dept.slug}: ${msg}`);
        }
      }
    }

    // 3. Create cross-functional channels
    for (const cf of CROSS_FUNCTIONAL_CHANNELS) {
      try {
        const channel = client.channel('cross-functional', cf.id, {
          name: cf.name,
          description: cf.description,
          created_by_id: 'rounds-system',
        });
        await channel.create();
        await channel.addMembers([callerUserId]);
        results.push(`Cross-functional channel: ${cf.name}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('already exists') || msg.includes('already_exists')) {
          try {
            const existing = client.channel('cross-functional', cf.id);
            await existing.addMembers([callerUserId]);
          } catch { /* member may already be added */ }
          results.push(`Cross-functional channel exists: ${cf.name} — member added`);
        } else {
          results.push(`Error creating ${cf.id}: ${msg}`);
        }
      }
    }

    // 4. Create ops broadcast channel
    try {
      const broadcastChannel = client.channel('ops-broadcast', OPS_BROADCAST.id, {
        name: OPS_BROADCAST.name,
        description: OPS_BROADCAST.description,
        created_by_id: 'rounds-system',
      });
      await broadcastChannel.create();
      await broadcastChannel.addMembers([callerUserId]);
      results.push(`Broadcast channel: ${OPS_BROADCAST.name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists') || msg.includes('already_exists')) {
        try {
          const existing = client.channel('ops-broadcast', OPS_BROADCAST.id);
          await existing.addMembers([callerUserId]);
        } catch { /* member may already be added */ }
        results.push(`Broadcast channel exists: ${OPS_BROADCAST.name} — member added`);
      } else {
        results.push(`Error creating broadcast: ${msg}`);
      }
    }

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
