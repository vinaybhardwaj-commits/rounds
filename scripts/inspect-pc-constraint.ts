import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  const rows = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'patient_changelog'::regclass
  `;
  console.log(JSON.stringify(rows, null, 2));
})();
