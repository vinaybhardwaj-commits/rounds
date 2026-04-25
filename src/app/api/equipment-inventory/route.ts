// =============================================================================
// GET /api/equipment-inventory
//
// Lists active equipment inventory items visible to the caller's accessible
// hospitals. Powers the EquipmentRequestModal picker.
//
// Query params:
//   q          — full-text search across item_label / brand / model
//   category   — 'surgical_equipment' | 'infrastructure' | 'consumable' | 'kit'
//   limit      — default 200, max 1000
//
// 25 Apr 2026 — companion to migration-equipment-inventory.sql.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface InventoryRow {
  id: string;
  hospital_id: string;
  hospital_slug: string | null;
  category: string;
  subcategory: string | null;
  item_label: string;
  brand: string | null;
  model: string | null;
  size_spec: string | null;
  is_rentable: boolean;
  default_vendor_name: string | null;
  default_vendor_phone: string | null;
  notes: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const category = searchParams.get('category');
    const limitRaw = parseInt(searchParams.get('limit') || '200', 10);
    const limit = Math.max(1, Math.min(1000, isNaN(limitRaw) ? 200 : limitRaw));

    const conditions: string[] = [
      'ei.hospital_id = ANY(user_accessible_hospital_ids($1::UUID))',
      'ei.is_active = TRUE',
    ];
    const params: unknown[] = [user.profileId];

    if (category) {
      conditions.push(`ei.category = $${params.length + 1}::TEXT`);
      params.push(category);
    }
    if (q.length > 0) {
      // Match label / brand / model / subcategory case-insensitively.
      conditions.push(`(
        ei.item_label  ILIKE $${params.length + 1}
        OR ei.brand    ILIKE $${params.length + 1}
        OR ei.model    ILIKE $${params.length + 1}
        OR ei.subcategory ILIKE $${params.length + 1}
      )`);
      params.push(`%${q}%`);
    }

    const where = conditions.join(' AND ');

    const rows = await query<InventoryRow>(
      `
      SELECT
        ei.id, ei.hospital_id, h.slug AS hospital_slug,
        ei.category, ei.subcategory, ei.item_label, ei.brand, ei.model,
        ei.size_spec, ei.is_rentable, ei.default_vendor_name,
        ei.default_vendor_phone, ei.notes
      FROM equipment_inventory ei
      LEFT JOIN hospitals h ON h.id = ei.hospital_id
      WHERE ${where}
      ORDER BY
        CASE ei.category
          WHEN 'kit' THEN 0
          WHEN 'surgical_equipment' THEN 1
          WHEN 'infrastructure' THEN 2
          WHEN 'consumable' THEN 3
          ELSE 4
        END,
        ei.item_label
      LIMIT ${limit}
      `,
      params
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    const e = error as { message?: string; code?: string };
    console.error('GET /api/equipment-inventory error:', JSON.stringify({ message: e.message, code: e.code }));
    return NextResponse.json(
      { success: false, error: 'Failed to load equipment inventory' },
      { status: 500 }
    );
  }
}
