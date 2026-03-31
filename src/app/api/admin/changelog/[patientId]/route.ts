// ============================================
// GET /api/admin/changelog/[patientId]
// Full timeline for a patient: DB changelog entries
// + GetStream chat messages, merged and sorted.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getStreamServerClient } from '@/lib/getstream';

interface TimelineEntry {
  id: string;
  type: 'changelog' | 'message' | 'form';
  timestamp: string;
  // Changelog fields
  change_type?: string;
  field_name?: string;
  old_display?: string;
  new_display?: string;
  // Message fields
  text?: string;
  message_type?: string;
  // Common
  user_name: string;
  user_id?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { patientId } = params;

  try {
    // 1. Get patient info
    const patient = await queryOne<{
      id: string;
      patient_name: string;
      uhid: string | null;
      ip_number: string | null;
      current_stage: string;
      getstream_channel_id: string | null;
    }>(
      `SELECT id, patient_name, uhid, ip_number, current_stage, getstream_channel_id
       FROM patient_threads WHERE id = $1`,
      [patientId]
    );

    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // 2. Get DB changelog entries
    const changelogRows = await query<{
      id: string;
      change_type: string;
      field_name: string | null;
      old_display: string | null;
      new_display: string | null;
      changed_by_name: string | null;
      changed_by: string;
      notes: string | null;
      created_at: string;
    }>(
      `SELECT id, change_type, field_name, old_display, new_display, changed_by_name, changed_by, notes, created_at
       FROM patient_changelog
       WHERE patient_thread_id = $1
       ORDER BY created_at ASC`,
      [patientId]
    );

    // 3. Get form submissions
    const formRows = await query<{
      id: string;
      form_type: string;
      status: string;
      submitted_by_name: string | null;
      submitted_by: string;
      created_at: string;
    }>(
      `SELECT fs.id, fs.form_type, fs.status,
              p.full_name as submitted_by_name, fs.submitted_by, fs.created_at
       FROM form_submissions fs
       LEFT JOIN profiles p ON fs.submitted_by = p.id
       WHERE fs.patient_thread_id = $1
       ORDER BY fs.created_at ASC`,
      [patientId]
    );

    // 4. Build timeline from DB data
    const timeline: TimelineEntry[] = [];

    for (const cl of changelogRows) {
      timeline.push({
        id: cl.id,
        type: 'changelog',
        timestamp: cl.created_at,
        change_type: cl.change_type,
        field_name: cl.field_name || undefined,
        old_display: cl.old_display || undefined,
        new_display: cl.new_display || undefined,
        user_name: cl.changed_by_name || 'Unknown',
        user_id: cl.changed_by,
      });
    }

    for (const form of formRows) {
      timeline.push({
        id: form.id,
        type: 'form',
        timestamp: form.created_at,
        change_type: 'form_submission',
        field_name: form.form_type,
        new_display: form.status,
        user_name: form.submitted_by_name || 'Unknown',
        user_id: form.submitted_by,
      });
    }

    // 5. Get GetStream messages (if channel exists)
    if (patient.getstream_channel_id) {
      try {
        const client = getStreamServerClient();
        const channel = client.channel('messaging', patient.getstream_channel_id);

        // Query up to 300 messages
        const response = await channel.query({
          messages: { limit: 300 },
          state: true,
        });

        if (response.messages) {
          for (const msg of response.messages) {
            timeline.push({
              id: msg.id,
              type: 'message',
              timestamp: msg.created_at || new Date().toISOString(),
              text: msg.text || '',
              message_type: (msg as Record<string, unknown>).message_type as string || 'chat',
              user_name: msg.user?.name || msg.user?.id || 'System',
              user_id: msg.user?.id,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch GetStream messages for changelog:', err);
        // Non-fatal — continue with DB-only timeline
      }
    }

    // 6. Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return NextResponse.json({
      success: true,
      data: {
        patient,
        timeline,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/changelog/[patientId] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch changelog' }, { status: 500 });
  }
}
