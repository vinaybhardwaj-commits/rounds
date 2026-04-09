import * as fs from 'fs';
import * as path from 'path';
// Load .env.local manually (matches pattern in other smoke tests)
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
import { query } from '../src/lib/db';

async function main() {
  const cols = await query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'dedup_log' AND table_schema = 'public'
     ORDER BY ordinal_position`
  );
  console.log('dedup_log columns:');
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(30)} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
  }

  const count = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM dedup_log`);
  console.log(`\nTotal rows: ${count[0].count}`);

  const actions = await query<{ action: string; count: string }>(
    `SELECT action, COUNT(*)::text as count FROM dedup_log GROUP BY action ORDER BY count DESC`
  );
  console.log('\nAction types:');
  for (const a of actions) console.log(`  ${a.action.padEnd(40)} ${a.count}`);

  const endpoints = await query<{ endpoint: string; count: string }>(
    `SELECT endpoint, COUNT(*)::text as count FROM dedup_log GROUP BY endpoint ORDER BY count DESC`
  );
  console.log('\nEndpoints:');
  for (const e of endpoints) console.log(`  ${String(e.endpoint).padEnd(40)} ${e.count}`);

  const sample = await query<Record<string, unknown>>(
    `SELECT * FROM dedup_log ORDER BY created_at DESC LIMIT 3`
  );
  console.log('\nSample rows (latest 3):');
  for (const row of sample) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
