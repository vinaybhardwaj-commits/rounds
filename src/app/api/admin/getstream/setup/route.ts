// ============================================
// POST /api/admin/getstream/setup
// One-time setup: creates channel types & bot user.
// Protected: super_admin only.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { runGetStreamSetup } from '@/lib/getstream-setup';

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

    // Run the setup
    const results = await runGetStreamSetup();

    return NextResponse.json({
      success: true,
      data: results,
      message: 'GetStream setup completed',
    });
  } catch (error) {
    console.error('POST /api/admin/getstream/setup error:', error);
    const message = error instanceof Error ? error.message : 'Setup failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
