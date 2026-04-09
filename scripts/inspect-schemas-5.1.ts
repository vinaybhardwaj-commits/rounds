import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  for (const table of ['patient_changelog', 'readiness_items', 'files', 'patient_files']) {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = ${table}
      ORDER BY ordinal_position
    `;
    console.log(`=== ${table} ===`);
    console.log(JSON.stringify(cols, null, 2));
    console.log();
  }
})();
