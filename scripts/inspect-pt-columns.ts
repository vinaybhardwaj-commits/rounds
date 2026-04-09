import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envFile = fs.readFileSync(path.resolve('.env.local'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'patient_threads'
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify(cols, null, 2));
})();
