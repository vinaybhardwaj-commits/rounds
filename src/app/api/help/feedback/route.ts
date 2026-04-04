// ============================================
// POST /api/help/feedback
// Records thumbs-up / thumbs-down for a help
// interaction. Updates help_interactions.helpful.
// Auth required.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { interactionId, helpful } = body;

    if (typeof interactionId !== 'number' || typeof helpful !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'interactionId (number) and helpful (boolean) are required' },
        { status: 400 }
      );
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // Only allow updating own interactions
    const result = await sql(
      `UPDATE help_interactions
       SET helpful = $1
       WHERE id = $2 AND profile_id = $3
       RETURNING id`,
      [helpful, interactionId, user.profileId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Interaction not found or not yours' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/help/feedback error:', error);
    return NextResponse.json({ success: false, error: 'Feedback failed' }, { status: 500 });
  }
}
