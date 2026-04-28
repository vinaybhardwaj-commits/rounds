import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { isValidRole } from '@/lib/roles';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type { CSVImportResult } from '@/types';

let _sql: ReturnType<typeof neon> | null = null;
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql(strings, ...values);
}

// POST /api/profiles/import — bulk import profiles from CSV
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name?.toLowerCase() || '';
    let records: Record<string, string>[];

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Parse XLSX/XLS using SheetJS
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Auto-detect the header row: find the row containing "email" in column A
      const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1');
      let headerRowIdx = 0;
      for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c: 0 });
        const cellVal = String(firstSheet[cellAddr]?.v ?? '').trim().toLowerCase();
        if (cellVal === 'email') {
          headerRowIdx = r;
          break;
        }
      }

      // Convert to JSON starting from the detected header row
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
        range: headerRowIdx,
      });

      // Convert all values to strings and filter out example/empty rows
      records = raw
        .map(row => {
          const clean: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            clean[k.trim().toLowerCase()] = String(v ?? '').trim();
          }
          return clean;
        })
        .filter(row => {
          // Must have a proper email (user@domain.tld), skip notes/header rows
          const email = row.email || '';
          return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
        });
    } else {
      // Parse CSV
      const csvText = await file.text();
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    }

    // Pre-fetch department slugs for mapping
    const departments = await sql`SELECT id, slug, name FROM departments WHERE is_active = true`;
    const deptMap = new Map<string, string>();
    for (const d of departments) {
      const dept = d as Record<string, string>;
      deptMap.set(dept.slug.toLowerCase(), dept.id);
      deptMap.set(dept.name.toLowerCase(), dept.id);
    }

    // v1.1 (28 Apr 2026) — MH.1 made profiles.primary_hospital_id NOT NULL
    // (no DB default). Bulk CSV import was never updated. Resolve EHRC's
    // hospital_id once and stamp every new row with it. Existing rows on
    // ON CONFLICT keep their hospital_id (we don't overwrite). Admins who
    // need to reassign a user to EHBR can use /admin/users → Edit Profile
    // (MH.7c) post-import.
    const hospitalRows = await sql`
      SELECT id::text AS id FROM hospitals WHERE slug = 'ehrc' AND is_active = TRUE LIMIT 1
    `;
    const hospitalRowArr = hospitalRows as unknown as Array<{ id: string }>;
    const defaultHospitalId = hospitalRowArr[0]?.id;
    if (!defaultHospitalId) {
      return NextResponse.json(
        { success: false, error: 'Bulk import is misconfigured (no active EHRC hospital row).' },
        { status: 500 }
      );
    }

    const result: CSVImportResult = {
      total: records.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const email = (row.email || '').trim().toLowerCase();
      const fullName = (row.full_name || row.name || '').trim();
      const deptKey = (row.department || row.dept || '').trim().toLowerCase();
      const role = (row.role || 'staff').trim().toLowerCase();
      const designation = (row.designation || row.title || '').trim() || null;
      const phone = (row.phone || row.mobile || '').trim() || null;

      // Validate email
      if (!email || !email.includes('@')) {
        result.errors.push({ row: i + 2, email: email || '(empty)', error: 'Invalid or missing email' });
        result.skipped++;
        continue;
      }

      if (!fullName) {
        result.errors.push({ row: i + 2, email, error: 'Missing full_name' });
        result.skipped++;
        continue;
      }

      // Resolve department
      const departmentId = deptMap.get(deptKey) || null;

      // Validate role against the canonical UserRole type
      const finalRole = isValidRole(role) ? role : 'staff';

      try {
        const upsertResult = await sql`
          INSERT INTO profiles (email, full_name, role, department_id, designation, phone, account_type, primary_hospital_id)
          VALUES (
            ${email},
            ${fullName},
            ${finalRole},
            ${departmentId},
            ${designation},
            ${phone},
            ${email.endsWith('@even.in') ? 'internal' : 'guest'},
            ${defaultHospitalId}::uuid
          )
          ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            role = EXCLUDED.role,
            department_id = EXCLUDED.department_id,
            designation = EXCLUDED.designation,
            phone = EXCLUDED.phone,
            updated_at = NOW()
            -- v1.1: do NOT touch primary_hospital_id on conflict — existing
            -- rows keep their hospital assignment. CSV upload never reassigns
            -- a user's hospital (use /admin/users for that).
          RETURNING (xmax = 0) AS is_new
        `;

        if ((upsertResult[0] as Record<string, unknown>)?.is_new) {
          result.created++;
        } else {
          result.updated++;
        }
      } catch (err) {
        result.errors.push({ row: i + 2, email, error: String(err) });
        result.skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: `Imported ${result.created} new, updated ${result.updated}, skipped ${result.skipped} of ${result.total} rows`,
    });
  } catch (error) {
    console.error('POST /api/profiles/import error:', error);
    return NextResponse.json({ success: false, error: 'Import failed — check file format (CSV or XLSX)' }, { status: 500 });
  }
}
