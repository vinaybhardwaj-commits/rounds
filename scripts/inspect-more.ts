import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sql = neon(process.env.POSTGRES_URL!);
(async () => {
  for (const table of ['claim_events', 'escalation_log', 'insurance_claims']) {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = ${table}
      ORDER BY ordinal_position
    `;
    console.log(`=== ${table} ===`);
    for (const c of (cols as unknown as Array<{column_name:string;data_type:string;is_nullable:string;column_default:string|null}>)) {
      console.log(`  ${c.column_name} (${c.data_type}${c.is_nullable==='NO'?' NOT NULL':''}${c.column_default?` default ${c.column_default}`:''})`);
    }
    console.log();
  }
})();
