import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  const fks = await sql`
    SELECT
      tc.table_name,
      kcu.column_name,
      pg_get_constraintdef(pgc.oid) AS definition
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN pg_constraint pgc
      ON tc.constraint_name = pgc.conname
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name IN (
        SELECT constraint_name
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'patient_threads' AND column_name = 'id'
      )
    ORDER BY tc.table_name, kcu.column_name
  `;
  console.log(JSON.stringify(fks, null, 2));
})();
