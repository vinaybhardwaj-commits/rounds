// ============================================
// GET /api/files/[id] — Get file metadata
// PATCH /api/files/[id] — Update description, tags, category
// DELETE /api/files/[id] — Soft-delete file (no hard delete)
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

interface FileRecord {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  blob_url: string;
  uploaded_by: string;
  uploaded_by_name: string | null;
  category: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  patient_count: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const file = await queryOne<FileRecord>(
      `SELECT f.*, p.full_name as uploaded_by_name,
              (SELECT COUNT(*) FROM patient_files pf WHERE pf.file_id = f.id)::int as patient_count
       FROM files f
       LEFT JOIN profiles p ON p.id = f.uploaded_by
       WHERE f.id = $1 AND f.is_deleted = false`,
      [params.id]
    );

    if (!file) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    // Also fetch linked patients
    const patients = await query<{ patient_thread_id: string; patient_name: string; link_context: string; linked_at: string }>(
      `SELECT pf.patient_thread_id, pt.patient_name, pf.link_context, pf.created_at as linked_at
       FROM patient_files pf
       JOIN patient_threads pt ON pt.id = pf.patient_thread_id
       WHERE pf.file_id = $1
       ORDER BY pf.created_at DESC`,
      [params.id]
    );

    return NextResponse.json({
      success: true,
      data: { ...file, linked_patients: patients },
    });
  } catch (error) {
    console.error('GET /api/files/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch file' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { description, tags, category } = body;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (description !== undefined) {
      setClauses.push(`description = $${paramIdx++}`);
      values.push(description);
    }
    if (tags !== undefined) {
      setClauses.push(`tags = $${paramIdx++}`);
      values.push(tags);
    }
    if (category !== undefined) {
      setClauses.push(`category = $${paramIdx++}`);
      values.push(category);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(params.id);

    await query(
      `UPDATE files SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND is_deleted = false`,
      values
    );

    return NextResponse.json({ success: true, message: 'File updated' });
  } catch (error) {
    console.error('PATCH /api/files/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update file' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Soft delete only — no hard deletes per policy
    await query(
      `UPDATE files SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [params.id]
    );

    return NextResponse.json({ success: true, message: 'File soft-deleted' });
  } catch (error) {
    console.error('DELETE /api/files/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete file' }, { status: 500 });
  }
}
