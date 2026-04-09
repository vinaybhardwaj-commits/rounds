import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'patient_files'
  `;
  console.log('=== patient_files indexes ===');
  console.log(JSON.stringify(idx, null, 2));

  const cons = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'patient_files'::regclass
  `;
  console.log('\n=== patient_files constraints ===');
  console.log(JSON.stringify(cons, null, 2));
})();
