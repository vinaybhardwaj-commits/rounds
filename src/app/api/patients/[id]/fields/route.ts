// ============================================
// PATCH /api/patients/[id]/fields
// Update patient fields (consultant, department, bed)
// with changelog logging for full traceability.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPatientThread, updatePatientThread } from '@/lib/db-v5';
import { query, queryOne } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();
    const {
      primary_consultant_id,
      // 25 Apr 2026: client may send resolved name (id may be from
      // /api/doctors which unions profiles + reference_doctors).
      primary_consultant_name: bodyConsultantName,
      department_id,
      bed_number,
      room_number,
    } = body;

    // Get current patient for old values
    const patient = await getPatientThread(id);
    if (!patient) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // Resolve display names for changelog
    const changelogs: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      old_display: string | null;
      new_display: string | null;
    }> = [];

    // --- Consultant change ---
    if (primary_consultant_id !== undefined && primary_consultant_id !== patient.primary_consultant_id) {
      let newConsultantName: string | null = bodyConsultantName || null;
      if (primary_consultant_id && !newConsultantName) {
        // Try profiles first, then reference_doctors. Both tables share
        // a UUID id space so a single id will match at most one row.
        const profile = await queryOne<{ full_name: string }>(
          `SELECT full_name FROM profiles WHERE id = $1`, [primary_consultant_id]
        );
        if (profile?.full_name) {
          newConsultantName = profile.full_name;
        } else {
          const ref = await queryOne<{ full_name: string }>(
            `SELECT full_name FROM reference_doctors WHERE id = $1`, [primary_consultant_id]
          );
          newConsultantName = ref?.full_name || null;
        }
      }

      changelogs.push({
        field_name: 'primary_consultant_id',
        old_value: (patient.primary_consultant_id as string) || null,
        new_value: primary_consultant_id || null,
        old_display: (patient.primary_consultant_name as string) || 'None',
        new_display: newConsultantName || 'None',
      });

      // 25 Apr 2026: write both id + name (no FK on id since the consultant
      // may live in reference_doctors, not profiles).
      await updatePatientThread(id, {
        primary_consultant_id: primary_consultant_id || null,
        primary_consultant_name: newConsultantName,
      });
    }

    // --- Department change ---
    if (department_id !== undefined && department_id !== patient.department_id) {
      let newDeptName: string | null = null;
      if (department_id) {
        const dept = await queryOne<{ name: string }>(
          `SELECT name FROM departments WHERE id = $1`, [department_id]
        );
        newDeptName = dept?.name || null;
      }

      changelogs.push({
        field_name: 'department_id',
        old_value: (patient.department_id as string) || null,
        new_value: department_id || null,
        old_display: (patient.department_name as string) || 'None',
        new_display: newDeptName || 'None',
      });

      await updatePatientThread(id, { department_id: department_id || null });
    }

    // --- Bed change (on admission_tracker) ---
    if (bed_number !== undefined || room_number !== undefined) {
      const oldBed = (patient.bed_number as string) || null;
      const oldRoom = (patient.room_number as string) || null;

      const newBed = bed_number !== undefined ? bed_number : oldBed;
      const newRoom = room_number !== undefined ? room_number : oldRoom;

      // Check if admission tracker exists
      const tracker = await queryOne<{ id: string }>(
        `SELECT id FROM admission_tracker WHERE patient_thread_id = $1`, [id]
      );

      if (tracker) {
        // Update existing tracker
        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (bed_number !== undefined) {
          setClauses.push(`bed_number = $${paramIdx++}`);
          params.push(bed_number || null);
        }
        if (room_number !== undefined) {
          setClauses.push(`room_number = $${paramIdx++}`);
          params.push(room_number || null);
        }

        if (setClauses.length > 0) {
          params.push(id);
          await query(
            `UPDATE admission_tracker SET ${setClauses.join(', ')} WHERE patient_thread_id = $${paramIdx}`,
            params
          );
        }
      } else {
        // No admission_tracker row yet — create one with minimal required fields from the patient thread
        await query(
          `INSERT INTO admission_tracker (patient_thread_id, patient_name, uhid, ip_number, admission_date, bed_number, room_number)
           VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, NOW()), $6, $7)`,
          [
            id,
            patient.patient_name,
            patient.uhid || '',
            patient.ip_number || '',
            patient.admission_date || null,
            bed_number || null,
            room_number || null,
          ]
        );
      }

      // Log bed change
      const oldDisplay = oldBed ? `${oldBed}${oldRoom ? ` · ${oldRoom}` : ''}` : 'None';
      const newDisplay = newBed ? `${newBed}${newRoom ? ` · ${newRoom}` : ''}` : 'None';

      if (oldDisplay !== newDisplay) {
        changelogs.push({
          field_name: 'bed_number',
          old_value: oldBed,
          new_value: newBed,
          old_display: oldDisplay,
          new_display: newDisplay,
        });
      }
    }

    // Write all changelog entries
    for (const cl of changelogs) {
      try {
        await query(
          `INSERT INTO patient_changelog (patient_thread_id, change_type, field_name, old_value, new_value, old_display, new_display, changed_by, changed_by_name)
           VALUES ($1, 'field_edit', $2, $3, $4, $5, $6, $7, $8)`,
          [id, cl.field_name, cl.old_value, cl.new_value, cl.old_display, cl.new_display, user.profileId, user.email]
        );
      } catch (err) {
        console.error('Failed to log field change:', err);
      }
    }

    return NextResponse.json({
      success: true,
      data: { changes: changelogs.length },
      message: `${changelogs.length} field(s) updated`,
    });
  } catch (error) {
    console.error('PATCH /api/patients/[id]/fields error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update fields' }, { status: 500 });
  }
}
