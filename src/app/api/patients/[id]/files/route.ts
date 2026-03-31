// ============================================
// GET /api/patients/[id]/files — List all files linked to a patient
// POST /api/patients/[id]/files — Link an existing file to this patient
// DELETE /api/patients/[id]/files?file_id=X — Unlink a file from this patient
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface PatientFile {
  id: string;
  file_id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  blob_url: string;
  category: string;
  description: string | null;
  tags: string[];
  uploaded_by_name: string | null;
  link_context: string;
  notes: string | null;
  linked_by_name: string | null;
  file_created_at: string;
  linked_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let whereExtra = '';
    const queryParams: unknown[] = [params.id];
    let paramIdx = 2;

    if (category) {
      whereExtra += ` AND f.category = $${paramIdx++}`;
      queryParams.push(category);
    }

    if (search) {
      whereExtra += ` AND (f.original_filename ILIKE $${paramIdx} OR f.description ILIKE $${paramIdx} OR f.category ILIKE $${paramIdx})`;
      queryParams.push(`%${search}%`);
      paramIdx++;
    }

    const files = await query<PatientFile>(
      `SELECT pf.id, pf.file_id, f.filename, f.original_filename, f.mime_type, f.size_bytes,
              f.blob_url, f.category, f.description, f.tags,
              up.full_name as uploaded_by_name,
              pf.link_context, pf.notes,
              lb.full_name as linked_by_name,
              f.created_at as file_created_at,
              pf.created_at as linked_at
       FROM patient_files pf
       JOIN files f ON f.id = pf.file_id AND f.is_deleted = false
       LEFT JOIN profiles up ON up.id = f.uploaded_by
       LEFT JOIN profiles lb ON lb.id = pf.linked_by
       WHERE pf.patient_thread_id = $1${whereExtra}
       ORDER BY pf.created_at DESC`,
      queryParams
    );

    return NextResponse.json({ success: true, data: files, count: files.length });
  } catch (error) {
    console.error('GET /api/patients/[id]/files error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch files' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { file_id, link_context, notes } = body;

    if (!file_id) {
      return NextResponse.json({ success: false, error: 'file_id is required' }, { status: 400 });
    }

    // Verify file exists and isn't deleted
    const file = await query<{ id: string }>(
      `SELECT id FROM files WHERE id = $1 AND is_deleted = false`,
      [file_id]
    );

    if (file.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    // Create the link (unique constraint will prevent duplicates)
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO patient_files (patient_thread_id, file_id, linked_by, link_context, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [params.id, file_id, user.profileId, link_context || 'manual_link', notes || null]
      );

      return NextResponse.json({
        success: true,
        data: { id: rows[0]?.id },
        message: 'File linked to patient',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return NextResponse.json({ success: false, error: 'File already linked to this patient' }, { status: 409 });
      }
      throw e;
    }
  } catch (error) {
    console.error('POST /api/patients/[id]/files error:', error);
    return NextResponse.json({ success: false, error: 'Failed to link file' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('file_id');

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'file_id query param required' }, { status: 400 });
    }

    // Unlink only — does NOT delete the file itself
    await query(
      `DELETE FROM patient_files WHERE patient_thread_id = $1 AND file_id = $2`,
      [params.id, fileId]
    );

    return NextResponse.json({ success: true, message: 'File unlinked from patient' });
  } catch (error) {
    console.error('DELETE /api/patients/[id]/files error:', error);
    return NextResponse.json({ success: false, error: 'Failed to unlink file' }, { status: 500 });
  }
}
