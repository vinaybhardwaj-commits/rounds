/**
 * Rounds — Database Migration Script
 * Run: npx tsx scripts/migrate.ts
 *
 * Reads schema.sql and executes it against the Neon Postgres database.
 * Requires POSTGRES_URL in .env.local
 */

import { sql } from '@vercel/postgres';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
  console.log('🏥 Rounds — Running database migration...\n');

  const schemaPath = path.join(__dirname, '..', 'src', 'lib', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  // Split on semicolons and execute each statement
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  let executed = 0;
  let errors = 0;

  for (const statement of statements) {
    try {
      await sql.query(statement + ';');
      executed++;
      // Log first 60 chars of each statement
      const preview = statement.replace(/\s+/g, ' ').substring(0, 60);
      console.log(`  ✅ ${preview}...`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Ignore "already exists" errors
      if (message.includes('already exists')) {
        console.log(`  ⏭️  Already exists: ${statement.substring(0, 40)}...`);
      } else {
        console.error(`  ❌ Error: ${message}`);
        console.error(`     Statement: ${statement.substring(0, 80)}...`);
        errors++;
      }
    }
  }

  console.log(`\n📊 Migration complete: ${executed} executed, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
