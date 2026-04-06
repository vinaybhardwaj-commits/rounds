// TEMPORARY: Clear WA analysis test data. Delete after testing.
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const sql = neon(process.env.POSTGRES_URL!);
  const hashes = await sql('DELETE FROM wa_message_hashes RETURNING hash');
  await sql('DELETE FROM wa_extracted_points');
  await sql('DELETE FROM wa_global_flags');
  await sql('DELETE FROM wa_rubric_proposals WHERE analysis_id IS NOT NULL');
  const analyses = await sql('DELETE FROM wa_analyses RETURNING id');
  return NextResponse.json({
    success: true,
    deleted: { hashes: hashes.length, analyses: analyses.length },
  });
}
