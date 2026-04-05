import { getCurrentUser } from '@/lib/auth';
import { query as sqlQuery, queryOne } from '@/lib/db';
import { put } from '@vercel/blob';
import { generateFCPdf } from '@/lib/fc-pdf';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;

    // Fetch form submission
    const submission = await queryOne(
      'SELECT * FROM form_submissions WHERE id = $1',
      [id]
    );

    if (!submission) {
      return NextResponse.json(
        { error: 'Form submission not found' },
        { status: 404 }
      );
    }

    // If PDF URL exists, redirect to it
    if (submission.pdf_blob_url) {
      return NextResponse.redirect(submission.pdf_blob_url);
    }

    return NextResponse.json(
      { error: 'PDF not yet generated' },
      { status: 404 }
    );
  } catch (error) {
    console.error('[GET /api/forms/[id]/pdf]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;

    // Fetch form submission
    const submission = await queryOne(
      'SELECT * FROM form_submissions WHERE id = $1',
      [id]
    );

    if (!submission) {
      return NextResponse.json(
        { error: 'Form submission not found' },
        { status: 404 }
      );
    }

    // Verify it's a financial_counseling form
    if (submission.form_type !== 'financial_counseling') {
      return NextResponse.json(
        { error: 'This endpoint only supports financial_counseling forms' },
        { status: 400 }
      );
    }

    // If already locked WITH a PDF, return existing PDF URL
    if (submission.locked && submission.pdf_blob_url) {
      return NextResponse.json({
        pdf_url: submission.pdf_blob_url,
        submission_id: submission.id,
        message: 'PDF already generated',
      });
    }

    // Recovery: if locked WITHOUT a PDF (failed previous attempt), unlock after 60s
    if (submission.locked && !submission.pdf_blob_url) {
      const lockedAt = submission.locked_at ? new Date(submission.locked_at).getTime() : 0;
      const staleLockMs = 60_000; // 60 seconds
      if (Date.now() - lockedAt > staleLockMs) {
        await sqlQuery(
          'UPDATE form_submissions SET locked = false, locked_at = NULL WHERE id = $1',
          [id]
        );
        // Re-fetch the now-unlocked submission to continue
        submission.locked = false;
      } else {
        return NextResponse.json(
          { error: 'PDF generation in progress, please retry shortly' },
          { status: 409 }
        );
      }
    }

    // Fetch patient info
    const patient = await queryOne(
      'SELECT patient_name, uhid FROM patient_threads WHERE id = $1',
      [submission.patient_thread_id]
    );

    if (!patient) {
      return NextResponse.json(
        { error: 'Patient not found' },
        { status: 404 }
      );
    }

    // Fetch submitter info
    const submitter = await queryOne(
      'SELECT full_name FROM profiles WHERE id = $1',
      [submission.submitted_by]
    );

    if (!submitter) {
      return NextResponse.json(
        { error: 'Submitter not found' },
        { status: 404 }
      );
    }

    // Atomically lock to prevent duplicate PDF generation (race condition guard)
    const lockResult = await queryOne(
      `UPDATE form_submissions SET locked = true, locked_at = NOW()
       WHERE id = $1 AND locked = false RETURNING id`,
      [id]
    );
    if (!lockResult) {
      // Another request already locked it — re-fetch to get the PDF URL
      const refetched = await queryOne(
        'SELECT pdf_blob_url FROM form_submissions WHERE id = $1',
        [id]
      );
      if (refetched?.pdf_blob_url) {
        return NextResponse.json({ pdf_url: refetched.pdf_blob_url, submission_id: id, message: 'PDF already generated' });
      }
      return NextResponse.json({ error: 'Form is being processed by another request' }, { status: 409 });
    }

    // Generate PDF
    const version = submission.version_number || 1;
    const pdfBuffer = await generateFCPdf({
      formData: submission.form_data,
      patientName: patient.patient_name || 'Unknown Patient',
      submissionId: submission.id,
      versionNumber: version,
      submittedBy: submitter.full_name || 'Unknown',
      submittedAt: submission.created_at,
      changeReason: submission.change_reason || undefined,
      parentVersion: submission.parent_submission_id ? version - 1 : undefined,
    });

    if (!pdfBuffer) {
      // Unlock on failure
      await sqlQuery('UPDATE form_submissions SET locked = false, locked_at = NULL WHERE id = $1', [id]);
      return NextResponse.json(
        { error: 'Failed to generate PDF' },
        { status: 500 }
      );
    }

    // Generate filename
    const safeName = (patient.patient_name || 'patient').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const filename = `fc-pdfs/${safeName}-v${version}-${submission.id}.pdf`;

    // Upload to Vercel Blob
    const blob = await put(filename, pdfBuffer, {
      access: 'public',
      contentType: 'application/pdf',
    });

    // Create file record + link to patient (non-fatal — PDF is already on blob storage)
    let fileRecord: { id?: string } = {};
    try {
      // Step 1: Insert into `files` table (the actual file record)
      const dbFilename = `FC-${(patient.uhid || 'Unknown').replace(/[^a-zA-Z0-9._-]/g, '_')}-v${version}.pdf`;
      const fileRow = await queryOne(
        `INSERT INTO files (filename, original_filename, mime_type, size_bytes, blob_url, blob_pathname, uploaded_by, category, description, tags, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          dbFilename,
          `FC Form - ${patient.patient_name || 'Unknown'} - v${version}.pdf`,
          'application/pdf',
          pdfBuffer.length,
          blob.url,
          filename, // the blob pathname we used for upload
          user.profileId,
          'insurance', // category for the Files tab filter
          `Financial Counseling form v${version}`,
          ['financial-counseling', 'auto-generated'],
          JSON.stringify({ source: 'form_submission', form_type: 'financial_counseling', submission_id: id, version }),
        ]
      );

      if (fileRow?.id) {
        // Step 2: Link the file to the patient via `patient_files` junction table
        const linkRow = await queryOne(
          `INSERT INTO patient_files (patient_thread_id, file_id, linked_by, link_context)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [submission.patient_thread_id, fileRow.id, user.profileId, 'form_submission']
        );
        fileRecord = { id: linkRow?.id || fileRow.id };
      }
    } catch (fileErr) {
      console.error('[POST /api/forms/[id]/pdf] file record insert failed (non-fatal):', fileErr);
    }

    // Update form_submissions to lock and add PDF URLs
    const updatedSubmission = await queryOne(
      `UPDATE form_submissions
       SET pdf_url = $1, pdf_blob_url = $2, locked = true, locked_at = NOW()
       WHERE id = $3
       RETURNING id, pdf_url, pdf_blob_url, locked`,
      [blob.url, blob.url, id]
    );

    return NextResponse.json({
      success: true,
      pdf_url: updatedSubmission.pdf_blob_url,
      submission_id: updatedSubmission.id,
      file_id: fileRecord.id,
      locked: updatedSubmission.locked,
    });
  } catch (error) {
    console.error('[POST /api/forms/[id]/pdf]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
