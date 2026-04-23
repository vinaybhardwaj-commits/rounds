// ============================================
// GET /api/pac-conditions
//
// Returns active rows from pac_condition_library — powers the PAC publish
// modal's condition multi-select (Sprint 2 Day 7). Sorted by sort_order then
// label so the modal list stays stable.
//
// No tenancy needed — the library is a shared seed (12 rows from SOP V5 §6.3).
// Any authenticated user can read it.
//
// Response:
//   { success: true, data: [{ code, label, description, default_owner_role, sort_order }, ...] }
//
// Sprint 2 Day 7 (24 April 2026).
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface LibraryRow {
  id: string;
  code: string;
  label: string;
  description: string | null;
  default_owner_role: string | null;
  sort_order: number;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await query<LibraryRow>(
      `
      SELECT id, code, label, description, default_owner_role, sort_order
      FROM pac_condition_library
      WHERE is_active = true
      ORDER BY sort_order ASC, label ASC
      `,
      []
    );

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error('GET /api/pac-conditions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list PAC conditions' },
      { status: 500 }
    );
  }
}
