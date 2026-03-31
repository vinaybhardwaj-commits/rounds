// ============================================
// POST /api/files/upload
// Upload a file to Vercel Blob and create DB record.
// Optionally links to a patient via patient_thread_id.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  // PDFs
  'application/pdf',
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
  // Office docs
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain', 'text/csv',
  // Archives (for grouped documents)
  'application/zip',
]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const patientThreadId = formData.get('patient_thread_id') as string | null;
    const category = (formData.get('category') as string) || 'general';
    const description = formData.get('description') as string | null;
    const tagsRaw = formData.get('tags') as string | null;
    const linkContext = (formData.get('link_context') as string) || 'upload';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, { status: 400 });
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ success: false, error: `File type ${file.type} is not allowed` }, { status: 400 });
    }

    // Generate a unique pathname for Blob storage
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const pathname = `rounds/files/${timestamp}-${safeName}`;

    // Upload to Vercel Blob
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    });

    // Parse tags
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    // Build metadata
    const metadata: Record<string, unknown> = {
      original_size: file.size,
      upload_timestamp: new Date().toISOString(),
    };

    // Insert file record into DB
    const fileRows = await query<{ id: string }>(
      `INSERT INTO files (filename, original_filename, mime_type, size_bytes, blob_url, blob_pathname, uploaded_by, category, description, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [safeName, file.name, file.type, file.size, blob.url, pathname, user.profileId, category, description, tags, JSON.stringify(metadata)]
    );

    const fileId = fileRows[0]?.id;
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Failed to create file record' }, { status: 500 });
    }

    // If patient_thread_id provided, create the link
    let linkId: string | null = null;
    if (patientThreadId) {
      try {
        const linkRows = await query<{ id: string }>(
          `INSERT INTO patient_files (patient_thread_id, file_id, linked_by, link_context)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [patientThreadId, fileId, user.profileId, linkContext]
        );
        linkId = linkRows[0]?.id || null;
      } catch (e: unknown) {
        // Link might fail if patient doesn't exist, but file was already uploaded
        console.error('Failed to link file to patient:', e);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: fileId,
        filename: safeName,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        blob_url: blob.url,
        category,
        description,
        tags,
        patient_link_id: linkId,
      },
    });
  } catch (error) {
    console.error('POST /api/files/upload error:', error);
    return NextResponse.json({ success: false, error: 'Failed to upload file' }, { status: 500 });
  }
}
