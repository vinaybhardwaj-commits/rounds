// ============================================
// GET  /api/forms — list form submissions
// POST /api/forms — submit a form + auto-create
//   readiness items from schema definitions
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createFormSubmission, listFormSubmissions, createReadinessItem } from '@/lib/db-v5';
import { query as sqlQuery } from '@/lib/db';
import {
  FORM_REGISTRY,
  FORM_TYPE_LABELS,
  getReadinessItemDefs,
  validateFormData,
  computeCompletionScore,
} from '@/lib/form-registry';
import { sendSystemMessage } from '@/lib/getstream';
import { postPatientActivity } from '@/lib/patient-activity';
import type { FormType, FormStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const form_type = searchParams.get('form_type') as FormType | null;
    const patient_thread_id = searchParams.get('patient_thread_id');
    const status = searchParams.get('status') as FormStatus | null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const forms = await listFormSubmissions({
      form_type: form_type || undefined,
      patient_thread_id: patient_thread_id || undefined,
      status: status || undefined,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: forms });
  } catch (error) {
    console.error('GET /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list form submissions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { form_type, form_data } = body;

    if (!form_type) {
      return NextResponse.json(
        { success: false, error: 'form_type is required' },
        { status: 400 }
      );
    }
    if (!form_data || typeof form_data !== 'object') {
      return NextResponse.json(
        { success: false, error: 'form_data object is required' },
        { status: 400 }
      );
    }

    // Look up schema (optional — form engine may not define all types yet)
    const schema = FORM_REGISTRY[form_type as FormType];

    // Server-side validation (only if schema exists and status is not 'draft')
    const status = body.status || 'submitted';
    if (schema && status !== 'draft') {
      const validationErrors = validateFormData(schema, form_data);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            validationErrors,
          },
          { status: 422 }
        );
      }
    }

    // Compute completion score from schema
    const completionScore = schema
      ? computeCompletionScore(schema, form_data)
      : body.completion_score || null;

    // Create the form submission
    const result = await createFormSubmission({
      form_type,
      form_version: schema?.version || body.form_version || 1,
      form_data,
      submitted_by: user.profileId,
      patient_thread_id: body.patient_thread_id || undefined,
      getstream_message_id: body.getstream_message_id || undefined,
      getstream_channel_id: body.getstream_channel_id || undefined,
      department_id: body.department_id || undefined,
      completion_score: completionScore,
      status,
    });

    const formId = result.id;

    // Auto-generate readiness items from schema (only for submitted, not draft)
    let readinessItemsCreated = 0;
    if (schema && status !== 'draft') {
      const readinessDefs = getReadinessItemDefs(schema);

      for (const def of readinessDefs) {
        // Only create readiness item if the checkbox was checked (truthy)
        // or if the field doesn't exist in form_data (create all for non-checkbox schemas)
        const fieldValue = form_data[def.fieldKey];
        const fieldDef = schema.sections
          .flatMap((s) => s.fields)
          .find((f) => f.key === def.fieldKey);

        // For checkbox fields: create item only if checked
        // For non-checkbox fields: always create
        const isCheckbox = fieldDef?.type === 'checkbox';
        if (isCheckbox && !fieldValue) continue;

        // Calculate due_by from SLA hours
        let dueBy: string | undefined;
        if (def.slaHours) {
          const due = new Date();
          due.setHours(due.getHours() + def.slaHours);
          dueBy = due.toISOString();
        }

        try {
          await createReadinessItem({
            form_submission_id: formId,
            patient_thread_id: body.patient_thread_id || undefined,
            item_name: def.itemName,
            item_category: def.category,
            item_description: def.description,
            responsible_role: def.responsibleRole,
            due_by: dueBy,
          });
          readinessItemsCreated++;
        } catch (err) {
          console.error(`Failed to create readiness item "${def.itemName}":`, err);
          // Don't fail the whole submission for a readiness item error
        }
      }
    }

    // Post form card to GetStream channels
    const formLabel = FORM_TYPE_LABELS[form_type as FormType] || form_type;
    const formAttachment = {
      type: 'form_submission',
      form_id: formId,
      form_type: form_type,
      form_label: formLabel,
      status: 'submitted',
      submitted_by_name: user.email,
      completion_score: completionScore,
      readiness_items_created: readinessItemsCreated,
    };

    // Post dual activity message (patient thread + department) — always, not just when post_to_department is set
    if (status !== 'draft' && body.patient_thread_id) {
      // Look up patient name for the activity
      let patientName = 'Unknown';
      try {
        const ptRows = await sqlQuery<{ patient_name: string }>(
          `SELECT patient_name FROM patient_threads WHERE id = $1`,
          [body.patient_thread_id]
        );
        patientName = ptRows[0]?.patient_name || 'Unknown';
      } catch { /* non-fatal */ }

      await postPatientActivity({
        type: 'form_submitted',
        patientThreadId: body.patient_thread_id,
        patientName,
        patientChannelId: body.getstream_channel_id || null,
        actor: { profileId: user.profileId, name: user.email },
        data: {
          formLabel,
          formType: form_type,
          completionScore: completionScore,
          readinessItems: readinessItemsCreated,
        },
        attachment: formAttachment,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          id: formId,
          readiness_items_created: readinessItemsCreated,
        },
        message: status === 'draft'
          ? 'Draft saved'
          : `Form submitted with ${readinessItemsCreated} readiness item${readinessItemsCreated !== 1 ? 's' : ''}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/forms error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit form' },
      { status: 500 }
    );
  }
}
