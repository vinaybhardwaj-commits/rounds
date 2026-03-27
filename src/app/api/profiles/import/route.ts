import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { auth } from '@/lib/auth';
import { parse } from 'csv-parse/sync';
import type { CSVImportResult } from '@/types';

const sql = neon(process.env.POSTGRES_URL!);

// POST /api/profiles/import — bulk import profiles from CSV
// Expected CSV columns: email, full_name, department, role, designation, phone
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as Record<string, unknown>;
  if (user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Only Super Admins can import profiles' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No CSV file provided' }, { status: 400 });
    }

    const csvText = await file.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Pre-fetch department slugs for mapping
    const departments = await sql`SELECT id, slug, name FROM departments WHERE is_active = true`;
    const deptMap = new Map<string, string>();
    for (const d of departments) {
      const dept = d as Record<string, string>;
      deptMap.set(dept.slug.toLowerCase(), dept.id);
      deptMap.set(dept.name.toLowerCase(), dept.id);
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

      // Validate role
      const validRoles = ['super_admin', 'department_head', 'staff', 'pac_coordinator', 'marketing', 'guest'];
      const finalRole = validRoles.includes(role) ? role : 'staff';

      try {
        const upsertResult = await sql`
          INSERT INTO profiles (email, full_name, role, department_id, designation, phone, account_type)
          VALUES (
            ${email},
            ${fullName},
            ${finalRole},
            ${departmentId},
            ${designation},
            ${phone},
            ${email.endsWith('@even.in') ? 'internal' : 'guest'}
          )
          ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            role = EXCLUDED.role,
            department_id = EXCLUDED.department_id,
            designation = EXCLUDED.designation,
            phone = EXCLUDED.phone,
            updated_at = NOW()
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
    return NextResponse.json({ success: false, error: 'CSV import failed' }, { status: 500 });
  }
}
