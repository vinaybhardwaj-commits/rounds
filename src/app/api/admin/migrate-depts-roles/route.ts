// One-time migration: Add Marketing & Administration departments + new roles
// DELETE THIS FILE after running migration

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sql = neon(process.env.POSTGRES_URL!);
  const results: string[] = [];

  try {
    // 1. Widen role column
    await sql`ALTER TABLE profiles ALTER COLUMN role TYPE VARCHAR(30)`;
    results.push('Widened role column to VARCHAR(30)');

    // 2. Drop old CHECK constraint and add updated one
    await sql`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check`;
    results.push('Dropped old role CHECK constraint');

    await sql`ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'department_head', 'staff', 'ip_coordinator', 'anesthesiologist', 'ot_coordinator', 'nurse', 'billing_executive', 'insurance_coordinator', 'pharmacist', 'physiotherapist', 'marketing_executive', 'clinical_care', 'pac_coordinator', 'administrator', 'medical_administrator', 'operations_manager', 'unit_head', 'marketing', 'guest'))`;
    results.push('Added new role CHECK constraint with all roles');

    // 3. Insert Marketing department
    await sql`INSERT INTO departments (name, slug) VALUES ('Marketing', 'marketing') ON CONFLICT (slug) DO NOTHING`;
    results.push('Inserted Marketing department');

    // 4. Insert Administration department
    await sql`INSERT INTO departments (name, slug) VALUES ('Administration', 'administration') ON CONFLICT (slug) DO NOTHING`;
    results.push('Inserted Administration department');

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ success: false, error: String(error), results }, { status: 500 });
  }
}
