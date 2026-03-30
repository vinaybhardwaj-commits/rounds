// ============================================
// POST /api/patients/import — Bulk import IP patients from KareXpert CSV
//
// Accepts multipart/form-data with:
//   - file: CSV file (KareXpert IP patient export)
//   - date: optional date string (for reference, default today)
//
// Logic:
//   1. Parse CSV rows
//   2. For each row, check if UHID already exists in patient_threads → skip
//   3. Match or create doctor profiles (stub profiles for unknown doctors)
//   4. Match specialty → department
//   5. Create patient_thread with stage='admitted'
//   6. Create GetStream channel with auto-enrolled staff
//   7. Return summary: { created, skipped, errors, details[] }
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createPatientThread,
  updatePatientThread,
  findProfilesByRole,
  getDepartmentHead,
} from '@/lib/db-v5';
import { query, queryOne } from '@/lib/db';
import {
  createPatientChannel,
  sendSystemMessage,
} from '@/lib/getstream';

// ── CSV column → Rounds field mapping ──

interface CSVRow {
  uhid: string;
  patient_name: string;
  mobile: string;
  admission_no: string;
  age: string;
  gender: string;
  bed_no: string;
  admission_status: string;
  marked_for_discharge: string;
  payer_type: string;
  payer_name: string;
  admission_date: string;
  admission_type: string;
  admitting_doctor: string;
  admitting_specialty: string;
  treating_doctor: string;
  treating_specialty: string;
  ward_name: string;
  room: string;
  floor: string;
  lead_source: string;
  kin_contact: string;
  high_risk: string;
}

// Map KareXpert specialties to EHRC department slugs
const SPECIALTY_TO_DEPT_SLUG: Record<string, string> = {
  'orthopedics': 'ot',
  'orthopaedics': 'ot',
  'general surgery': 'ot',
  'surgery': 'ot',
  'internal medicine': 'nursing', // closest operational dept
  'medicine': 'nursing',
  'emergency': 'emergency',
  'emergency medicine': 'emergency',
  'radiology': 'radiology',
  'pharmacy': 'pharmacy',
  'diet': 'diet',
  'lab': 'clinical-lab',
  'clinical lab': 'clinical-lab',
  'nursing': 'nursing',
  'physiotherapy': 'nursing',
  'anaesthesia': 'ot',
  'anesthesia': 'ot',
  'anaesthesiology': 'ot',
  'anesthesiology': 'ot',
  'cardiology': 'nursing',
  'neurology': 'nursing',
  'nephrology': 'nursing',
  'urology': 'ot',
  'ent': 'ot',
  'ophthalmology': 'ot',
  'dermatology': 'nursing',
  'gastroenterology': 'nursing',
  'pulmonology': 'nursing',
  'oncology': 'nursing',
  'gynecology': 'ot',
  'obstetrics': 'nursing',
  'pediatrics': 'nursing',
};

function parseDateStr(dateStr: string): string | null {
  if (!dateStr) return null;
  // Format: "30/03/2026, 07:51 am" or "30/03/2026"
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})\s*(am|pm))?/i);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min, ampm] = match;
  let hour = hh ? parseInt(hh) : 0;
  const minute = min ? parseInt(min) : 0;
  if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${yyyy}-${mm}-${dd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function mapRow(raw: Record<string, string>): CSVRow {
  return {
    uhid: raw['UHID'] || '',
    patient_name: raw['Patient Name'] || '',
    mobile: raw['Mobile No'] || '',
    admission_no: raw['Admission No'] || '',
    age: raw['Age'] || '',
    gender: raw['Gender'] || '',
    bed_no: raw['Bed No.'] || '',
    admission_status: raw['Admission Status'] || '',
    marked_for_discharge: raw['Marked For Discharge'] || '',
    payer_type: raw['Payer Type'] || '',
    payer_name: raw['Payer Name'] || '',
    admission_date: raw['Admission Date/Time'] || '',
    admission_type: raw['Admission Type'] || '',
    admitting_doctor: raw['Admitting Doctor/Team'] || '',
    admitting_specialty: raw['Admitting Doctor Speciality'] || '',
    treating_doctor: raw['Treating Doctor/Team'] || '',
    treating_specialty: raw['Treating Doctor Speciality'] || '',
    ward_name: raw['Ward Name'] || '',
    room: raw['Room'] || '',
    floor: raw['Floor'] || '',
    lead_source: raw['Leadsource'] || '',
    kin_contact: raw['Kin Contact'] || '',
    high_risk: raw['High Risk'] || '',
  };
}

// ── Doctor profile matching / creation ──

// Cache to avoid repeated lookups within the same import
const doctorCache = new Map<string, string | null>();
const deptCache = new Map<string, string | null>();

async function findOrCreateDoctor(
  doctorName: string,
  specialty: string
): Promise<string | null> {
  if (!doctorName) return null;

  // Normalize name for matching
  const normalizedName = doctorName.trim();
  const cacheKey = normalizedName.toLowerCase();

  if (doctorCache.has(cacheKey)) {
    return doctorCache.get(cacheKey) || null;
  }

  // Try exact match first
  let profile = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE LOWER(full_name) = LOWER($1) AND status = 'active'`,
    [normalizedName]
  );

  if (!profile) {
    // Try fuzzy: strip "Dr " prefix and try
    const nameWithoutTitle = normalizedName.replace(/^(Dr\.?\s*|Mr\.?\s*|Mrs\.?\s*|Ms\.?\s*)/i, '').trim();
    profile = await queryOne<{ id: string }>(
      `SELECT id FROM profiles WHERE
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(full_name, 'Dr. ', ''), 'Dr ', ''), 'Mr ', ''), 'Mrs ', '')) ILIKE $1
        AND status = 'active'
      LIMIT 1`,
      [`%${nameWithoutTitle}%`]
    );
  }

  if (profile) {
    doctorCache.set(cacheKey, profile.id);
    return profile.id;
  }

  // Create stub profile
  // Generate a placeholder email from doctor name
  const emailSlug = normalizedName
    .toLowerCase()
    .replace(/^(dr\.?\s*)/i, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  const stubEmail = `${emailSlug}@even.in`;

  // Check if email already exists
  const existingEmail = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE email = $1`,
    [stubEmail]
  );

  if (existingEmail) {
    doctorCache.set(cacheKey, existingEmail.id);
    return existingEmail.id;
  }

  // Get department_id for this specialty
  const deptId = await findDepartmentBySpecialty(specialty);

  try {
    const newProfile = await query<{ id: string }>(
      `INSERT INTO profiles (full_name, email, role, status, department_id, designation, account_type)
       VALUES ($1, $2, 'staff', 'active', $3, $4, 'internal')
       RETURNING id`,
      [normalizedName, stubEmail, deptId, specialty || 'Doctor']
    );
    if (newProfile[0]) {
      doctorCache.set(cacheKey, newProfile[0].id);
      return newProfile[0].id;
    }
  } catch (err) {
    console.error(`Failed to create stub profile for ${doctorName}:`, err);
  }

  doctorCache.set(cacheKey, null);
  return null;
}

async function findDepartmentBySpecialty(specialty: string): Promise<string | null> {
  if (!specialty) return null;

  const key = specialty.toLowerCase().trim();
  if (deptCache.has(key)) return deptCache.get(key) || null;

  // First try exact slug match
  const slug = SPECIALTY_TO_DEPT_SLUG[key];
  if (slug) {
    const dept = await queryOne<{ id: string }>(
      `SELECT id FROM departments WHERE slug = $1`,
      [slug]
    );
    if (dept) {
      deptCache.set(key, dept.id);
      return dept.id;
    }
  }

  // Fallback: try matching department name
  const dept = await queryOne<{ id: string }>(
    `SELECT id FROM departments WHERE LOWER(name) ILIKE $1 LIMIT 1`,
    [`%${key}%`]
  );
  if (dept) {
    deptCache.set(key, dept.id);
    return dept.id;
  }

  deptCache.set(key, null);
  return null;
}

// ── Stage-specific roles (same as POST /api/patients) ──

function getStageRoles(stage: string): string[] {
  switch (stage) {
    case 'admitted': return ['nurse', 'pharmacist'];
    case 'pre_op': return ['anesthesiologist', 'ot_coordinator', 'nurse'];
    case 'surgery': return ['anesthesiologist', 'ot_coordinator'];
    case 'post_op': return ['nurse', 'physiotherapist'];
    case 'discharge': return ['billing_executive', 'pharmacist'];
    default: return [];
  }
}

// ── Main handler ──

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can bulk import
    if (!['super_admin', 'department_head'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admins can import patients' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No CSV file provided' },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const rawRows = parseCSV(csvText);

    if (rawRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'CSV file is empty or has no data rows' },
        { status: 400 }
      );
    }

    const rows = rawRows.map(mapRow).filter(r => r.uhid && r.patient_name);

    // Get all existing UHIDs in one query for dedup
    const existingPatients = await query<{ uhid: string }>(
      `SELECT uhid FROM patient_threads WHERE uhid IS NOT NULL`
    );
    const existingUhids = new Set(existingPatients.map(p => p.uhid.toLowerCase()));

    // Clear caches for this import batch
    doctorCache.clear();
    deptCache.clear();

    const results: {
      created: string[];
      skipped: string[];
      errors: { uhid: string; name: string; error: string }[];
      doctors_created: string[];
    } = {
      created: [],
      skipped: [],
      errors: [],
      doctors_created: [],
    };

    for (const row of rows) {
      // Dedup by UHID
      if (existingUhids.has(row.uhid.toLowerCase())) {
        results.skipped.push(`${row.patient_name} (${row.uhid})`);
        continue;
      }

      try {
        // Match or create doctor
        const doctorId = await findOrCreateDoctor(row.admitting_doctor, row.admitting_specialty);

        // Track if doctor was created (check if it was a new stub)
        if (doctorId && row.admitting_doctor) {
          // We track all doctors linked, the cache handles dedup
        }

        // Find department
        const deptId = await findDepartmentBySpecialty(row.admitting_specialty);

        // Parse admission date
        const admissionDate = parseDateStr(row.admission_date);

        // Build primary_diagnosis field with ward/bed/payer context
        const contextParts: string[] = [];
        if (row.ward_name) contextParts.push(`Ward: ${row.ward_name}`);
        if (row.bed_no) contextParts.push(`Bed: ${row.bed_no}`);
        if (row.floor) contextParts.push(`Floor: ${row.floor}`);
        if (row.payer_type && row.payer_type !== 'Cash') contextParts.push(`Payer: ${row.payer_name || row.payer_type}`);
        if (row.high_risk === 'Yes') contextParts.push('HIGH RISK');
        const contextStr = contextParts.length > 0 ? contextParts.join(' | ') : null;

        // Create patient thread
        const patientResult = await createPatientThread({
          patient_name: row.patient_name,
          uhid: row.uhid,
          ip_number: row.admission_no,
          current_stage: 'admitted',
          primary_consultant_id: doctorId || undefined,
          department_id: deptId || undefined,
          admission_date: admissionDate || undefined,
          lead_source: row.lead_source || undefined,
          primary_diagnosis: contextStr || undefined,
          created_by: user.profileId,
        });

        // Mark as existing to avoid dups within the same batch
        existingUhids.add(row.uhid.toLowerCase());

        // Create GetStream channel
        const memberIds = new Set<string>();
        memberIds.add(user.profileId);
        if (doctorId) memberIds.add(doctorId);

        // Add IP coordinators
        try {
          const ipCoords = await findProfilesByRole(['ip_coordinator']);
          ipCoords.forEach(p => memberIds.add(p.id));
        } catch { /* non-fatal */ }

        // Add department head
        if (deptId) {
          try {
            const headId = await getDepartmentHead(deptId);
            if (headId) memberIds.add(headId);
          } catch { /* non-fatal */ }
        }

        // Add stage roles for 'admitted'
        try {
          const stageStaff = await findProfilesByRole(getStageRoles('admitted'), deptId || undefined);
          stageStaff.forEach(p => memberIds.add(p.id));
        } catch { /* non-fatal */ }

        try {
          const channelId = await createPatientChannel({
            patientThreadId: patientResult.id,
            patientName: row.patient_name,
            uhid: row.uhid,
            currentStage: 'admitted',
            departmentId: deptId,
            createdById: user.profileId,
            memberIds: [...memberIds].filter(id => id !== user.profileId),
          });

          await updatePatientThread(patientResult.id, {
            getstream_channel_id: channelId as unknown as undefined,
          });

          await sendSystemMessage(
            'patient-thread',
            channelId,
            `📋 ${row.patient_name} (${row.uhid}) imported from KareXpert. IP: ${row.admission_no || 'N/A'} | Dr. ${row.admitting_doctor || 'Unassigned'} | ${row.admitting_specialty || ''}`
          );
        } catch (err) {
          console.error(`Channel creation failed for ${row.uhid}:`, err);
          // Non-fatal — patient DB record still created
        }

        results.created.push(`${row.patient_name} (${row.uhid})`);
      } catch (err) {
        console.error(`Failed to import ${row.uhid}:`, err);
        results.errors.push({
          uhid: row.uhid,
          name: row.patient_name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total_in_csv: rows.length,
        created: results.created.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
        created_list: results.created,
        skipped_list: results.skipped,
        error_list: results.errors,
      },
      message: `Imported ${results.created.length} patients, skipped ${results.skipped.length} existing, ${results.errors.length} errors.`,
    });
  } catch (error) {
    console.error('POST /api/patients/import error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process import' },
      { status: 500 }
    );
  }
}
