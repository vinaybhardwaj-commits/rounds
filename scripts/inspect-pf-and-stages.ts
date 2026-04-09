import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  // patient_files columns
  const pfCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'patient_files'
    ORDER BY ordinal_position
  `;
  console.log('=== patient_files columns ===');
  console.log(JSON.stringify(pfCols, null, 2));

  // stages in current_stage
  const stages = await sql`
    SELECT DISTINCT current_stage, COUNT(*) as n
    FROM patient_threads
    WHERE archived_at IS NULL
    GROUP BY current_stage
    ORDER BY n DESC
  `;
  console.log('\n=== current_stage distribution ===');
  console.log(JSON.stringify(stages, null, 2));
})();
