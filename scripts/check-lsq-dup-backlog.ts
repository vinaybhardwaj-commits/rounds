/**
 * One-off diagnostic: find any existing manual patient_threads whose
 * normalized phone matches an LSQ-sourced thread. These are dedup
 * backlog candidates that Phase 3 cleanup should resolve.
 *
 * Read-only. Safe to run anytime.
 */
import { query, queryOne } from '../src/lib/db';

interface Dup {
  manual_id: string;
  manual_name: string;
  manual_phone: string | null;
  manual_created: string;
  lsq_id: string;
  lsq_name: string;
  lsq_phone: string | null;
  lsq_lead_id: string | null;
  lsq_created: string;
}

async function main() {
  const totals = await queryOne<{ lsq: number; manual: number; both: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE source_type = 'lsq') AS lsq,
       COUNT(*) FILTER (WHERE source_type = 'manual') AS manual,
       COUNT(*) FILTER (WHERE source_type = 'lsq' AND lsq_lead_id IS NOT NULL) AS both
     FROM patient_threads WHERE archived_at IS NULL`
  );
  console.log(`Active threads — lsq=${totals?.lsq} manual=${totals?.manual} lsq_with_lead_id=${totals?.both}`);

  const dups = await query<Dup>(
    `
    WITH normalized AS (
      SELECT id, patient_name, phone, source_type, lsq_lead_id, created_at,
             RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) AS phone_norm
        FROM patient_threads
       WHERE archived_at IS NULL
         AND phone IS NOT NULL AND phone <> ''
    )
    SELECT
      m.id           AS manual_id,
      m.patient_name AS manual_name,
      m.phone        AS manual_phone,
      m.created_at   AS manual_created,
      l.id           AS lsq_id,
      l.patient_name AS lsq_name,
      l.phone        AS lsq_phone,
      l.lsq_lead_id,
      l.created_at   AS lsq_created
    FROM normalized m
    JOIN normalized l ON m.phone_norm = l.phone_norm AND m.id <> l.id
    WHERE m.source_type = 'manual'
      AND l.source_type = 'lsq'
    ORDER BY m.created_at DESC
    `
  );

  console.log(`\nDuplicate pairs (manual × lsq, same normalized phone): ${dups.length}`);
  for (const d of dups.slice(0, 20)) {
    console.log(`  • ${d.manual_name.padEnd(30)} [${d.manual_phone}]  ⇄  ${d.lsq_name.padEnd(30)} [${d.lsq_phone}]  lead=${d.lsq_lead_id}`);
  }
  if (dups.length > 20) console.log(`  ... and ${dups.length - 20} more`);

  // Also check: any LSQ rows with missing lsq_lead_id? (shouldn't exist)
  const orphans = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_threads
      WHERE source_type = 'lsq' AND lsq_lead_id IS NULL AND archived_at IS NULL`
  );
  console.log(`\nLSQ-sourced rows without lsq_lead_id: ${orphans?.n ?? 0}`);

  // And: any rows with phones that look bogus
  const bogus = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM patient_threads
      WHERE archived_at IS NULL
        AND phone IS NOT NULL AND phone <> ''
        AND LENGTH(regexp_replace(phone, '\\D', '', 'g')) < 10`
  );
  console.log(`Rows with phones shorter than 10 digits: ${bogus?.n ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
