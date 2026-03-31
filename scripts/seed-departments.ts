/**
 * Rounds — Seed 17 EHRC Departments
 * Run: npx tsx scripts/seed-departments.ts
 *
 * Seeds all 17 departments with their heads (matched by email).
 * Safe to run multiple times — uses ON CONFLICT.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL!);

const DEPARTMENTS = [
  { name: 'Emergency', slug: 'emergency', headEmail: 'gautham.shankar@even.in' },
  { name: 'Customer Care', slug: 'customer-care', headEmail: 'lavanya.r@even.in' },
  { name: 'Patient Safety', slug: 'patient-safety', headEmail: 'ankita.priya@even.in' },
  { name: 'Finance', slug: 'finance', headEmail: 'sathyamoorthy@even.in' },
  { name: 'Billing', slug: 'billing', headEmail: 'mohankumar.kesavamurthy@even.in' },
  { name: 'Supply Chain', slug: 'supply-chain', headEmail: 'cs.yogendra@even.in' },
  { name: 'Facility', slug: 'facility', headEmail: 'charan.kumar@even.in' },
  { name: 'Pharmacy', slug: 'pharmacy', headEmail: 'b.rajesh@even.in' },
  { name: 'Training', slug: 'training', headEmail: 'naveen.b@even.in' },
  { name: 'Clinical Lab', slug: 'clinical-lab', headEmail: 'chandrakala.ln@even.in' },
  { name: 'Radiology', slug: 'radiology', headEmail: 'n.saran@even.in' },
  { name: 'OT', slug: 'ot', headEmail: 'leela@even.in' },
  { name: 'HR & Manpower', slug: 'hr-manpower', headEmail: 'manjunath@even.in' },
  { name: 'Diet', slug: 'diet', headEmail: 'kamar.afshan@even.in' },
  { name: 'Biomedical', slug: 'biomedical', headEmail: 'arul@even.in' },
  { name: 'Nursing', slug: 'nursing', headEmail: 'mary.nirmala@even.in' },
  { name: 'IT', slug: 'it', headEmail: 'bv.dilip@even.in' },
  { name: 'Marketing', slug: 'marketing', headEmail: '' },
  { name: 'Administration', slug: 'administration', headEmail: '' },
];

async function seed() {
  console.log('🏥 Rounds — Seeding 19 EHRC departments...\n');

  let created = 0;
  let updated = 0;

  for (const dept of DEPARTMENTS) {
    try {
      // Look up the department head's profile ID (may not exist yet)
      const headResult = await sql`
        SELECT id FROM profiles WHERE email = ${dept.headEmail}
      `;
      const headId = (headResult[0] as Record<string, unknown>)?.id || null;

      const result = await sql`
        INSERT INTO departments (name, slug, head_profile_id)
        VALUES (${dept.name}, ${dept.slug}, ${headId})
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          head_profile_id = COALESCE(EXCLUDED.head_profile_id, departments.head_profile_id)
        RETURNING (xmax = 0) AS is_new
      `;

      if ((result[0] as Record<string, unknown>)?.is_new) {
        created++;
        console.log(`  ✅ Created: ${dept.name} (${dept.slug})`);
      } else {
        updated++;
        console.log(`  🔄 Updated: ${dept.name} (${dept.slug})`);
      }
    } catch (error) {
      console.error(`  ❌ Error seeding ${dept.name}:`, error);
    }
  }

  console.log(`\n📊 Seed complete: ${created} created, ${updated} updated`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
