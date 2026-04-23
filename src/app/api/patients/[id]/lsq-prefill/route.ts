// ============================================
// GET /api/patients/[id]/lsq-prefill
//
// Returns a compact object of LSQ-originated fields for a patient thread,
// used by the Marketing Handoff form to render the "From LeadSquared" block
// at the top of Section A.
//
// Auth: any authenticated user (caller must already be able to view the patient).
//
// Response shape (all optional — missing fields are null):
//   {
//     success: true,
//     data: {
//       lsq_lead_id, lsq_prospect_auto_id, lsq_lead_stage,
//       name, age, gender, mobile, whatsapp, email, uhid,
//       city, state, zip,
//       utm_source, utm_campaign, utm_medium, signup_url,
//       ailment, doctor_name, financial_category, hospital_location,
//       is_existing_member, member_type,
//       lsq_owner_name, lsq_owner_email,
//       lsq_created_on, lsq_last_synced_at,
//     }
//   }
//
// Sprint 1 Day 3 (23 April 2026).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';

interface LsqPrefillRow {
  lsq_lead_id: string | null;
  lsq_prospect_auto_id: string | null;
  lsq_lead_stage: string | null;
  patient_name: string | null;
  age: number | null;
  gender: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  uhid: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  signup_url: string | null;
  ailment: string | null;
  doctor_name: string | null;
  financial_category: string | null;
  hospital_location: string | null;
  is_existing_member: boolean | null;
  member_type: string | null;
  lsq_owner_name: string | null;
  lsq_owner_email: string | null;
  lsq_created_on: string | null;
  lsq_last_synced_at: string | null;
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

    const { id } = params;

    // Minimal column projection — we only need the LSQ-originated fields.
    const row = await queryOne<LsqPrefillRow>(
      `
      SELECT
        lsq_lead_id, lsq_prospect_auto_id, lsq_lead_stage,
        patient_name, age, gender,
        phone, whatsapp_number, email, uhid,
        city, state, zip,
        utm_source, utm_campaign, utm_medium, signup_url,
        ailment, doctor_name, financial_category, hospital_location,
        is_existing_member, member_type,
        lsq_owner_name, lsq_owner_email,
        lsq_created_on, lsq_last_synced_at
      FROM patient_threads
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!row) {
      return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
    }

    // Shape the response so the form can just spread it in (friendlier key names).
    const data = {
      lsq_lead_id: row.lsq_lead_id,
      lsq_prospect_auto_id: row.lsq_prospect_auto_id,
      lsq_lead_stage: row.lsq_lead_stage,
      name: row.patient_name,
      age: row.age,
      gender: row.gender,
      mobile: row.phone,
      whatsapp: row.whatsapp_number,
      email: row.email,
      uhid: row.uhid,
      city: row.city,
      state: row.state,
      zip: row.zip,
      utm_source: row.utm_source,
      utm_campaign: row.utm_campaign,
      utm_medium: row.utm_medium,
      signup_url: row.signup_url,
      ailment: row.ailment,
      doctor_name: row.doctor_name,
      financial_category: row.financial_category,
      hospital_location: row.hospital_location,
      is_existing_member: row.is_existing_member,
      member_type: row.member_type,
      lsq_owner_name: row.lsq_owner_name,
      lsq_owner_email: row.lsq_owner_email,
      lsq_created_on: row.lsq_created_on,
      lsq_last_synced_at: row.lsq_last_synced_at,
    };

    // has_lsq_data is a convenience flag for the UI to decide whether to
    // render the block at all (avoids a big empty panel for non-LSQ patients).
    const has_lsq_data = Boolean(
      row.lsq_lead_id || row.lsq_prospect_auto_id || row.lsq_owner_email
    );

    return NextResponse.json({
      success: true,
      data,
      has_lsq_data,
    });
  } catch (error) {
    console.error('GET /api/patients/[id]/lsq-prefill error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch LSQ prefill data' },
      { status: 500 }
    );
  }
}
