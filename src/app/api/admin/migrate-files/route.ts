// ============================================
// POST /api/admin/migrate-files
// One-time migration: creates files + patient_files tables.
// DELETE THIS ROUTE after successful migration.
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const results: string[] = [];
    const errors: string[] = [];

    // 1. Create files table
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS files (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          filename TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          blob_url TEXT NOT NULL,
          blob_pathname TEXT NOT NULL,
          uploaded_by UUID REFERENCES profiles(id),
          category TEXT DEFAULT 'general',
          description TEXT,
          tags TEXT[] DEFAULT '{}',
          metadata JSONB DEFAULT '{}',
          is_deleted BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      results.push('files table created');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) results.push('files table already exists');
      else errors.push(`files table: ${msg}`);
    }

    // 2. Create indexes on files
    const fileIndexes = [
      { name: 'idx_files_uploaded_by', sql: `CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by)` },
      { name: 'idx_files_category', sql: `CREATE INDEX IF NOT EXISTS idx_files_category ON files(category)` },
      { name: 'idx_files_created_at', sql: `CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC)` },
      { name: 'idx_files_is_deleted', sql: `CREATE INDEX IF NOT EXISTS idx_files_is_deleted ON files(is_deleted)` },
      { name: 'idx_files_mime_type', sql: `CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type)` },
    ];

    for (const idx of fileIndexes) {
      try {
        await query(idx.sql);
        results.push(`${idx.name} created`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('already exists')) results.push(`${idx.name} already exists`);
        else errors.push(`${idx.name}: ${msg}`);
      }
    }

    // 3. Create patient_files junction table
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS patient_files (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          patient_thread_id UUID NOT NULL REFERENCES patient_threads(id),
          file_id UUID NOT NULL REFERENCES files(id),
          linked_by UUID REFERENCES profiles(id),
          link_context TEXT DEFAULT 'upload',
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(patient_thread_id, file_id)
        )
      `);
      results.push('patient_files table created');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) results.push('patient_files table already exists');
      else errors.push(`patient_files table: ${msg}`);
    }

    // 4. Create indexes on patient_files
    const pfIndexes = [
      { name: 'idx_patient_files_patient', sql: `CREATE INDEX IF NOT EXISTS idx_patient_files_patient ON patient_files(patient_thread_id)` },
      { name: 'idx_patient_files_file', sql: `CREATE INDEX IF NOT EXISTS idx_patient_files_file ON patient_files(file_id)` },
      { name: 'idx_patient_files_linked_by', sql: `CREATE INDEX IF NOT EXISTS idx_patient_files_linked_by ON patient_files(linked_by)` },
    ];

    for (const idx of pfIndexes) {
      try {
        await query(idx.sql);
        results.push(`${idx.name} created`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('already exists')) results.push(`${idx.name} already exists`);
        else errors.push(`${idx.name}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      results,
      errors,
      summary: `${results.length} operations succeeded, ${errors.length} errors`,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ success: false, error: 'Migration failed' }, { status: 500 });
  }
}
