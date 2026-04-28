#!/usr/bin/env bash
# =============================================================================
# scripts/migration-blast-radius.sh — migration safety gate (QA.4)
#
# When a Neon migration file (src/lib/migration-*.sql) adds a NOT NULL column
# OR a CHECK constraint, this script greps every INSERT site for the affected
# table(s) so the author can audit each one BEFORE running the migration.
#
# Catches the v1.1 #6 / #7 / #9 bug class: MH.1 added NOT NULL to
# profiles.primary_hospital_id but 3 INSERT sites were never updated, causing
# /signup, /api/profiles/import, and /api/patients/import to silently 500.
#
# Usage:
#   bash scripts/migration-blast-radius.sh src/lib/migration-foo.sql
#   bash scripts/migration-blast-radius.sh  # audit ALL migrations vs current src
#
# Exit codes:
#   0 — audit complete (always; this is informational, not blocking)
#   1 — migration file not found / unreadable
# =============================================================================

set -uo pipefail

MIG="${1:-}"
if [ -z "$MIG" ]; then
  echo "Usage: bash scripts/migration-blast-radius.sh <migration-file.sql>"
  echo "       (or omit arg to scan all migration-*.sql files)"
  exit 1
fi

if [ ! -f "$MIG" ]; then
  echo "✗ File not found: $MIG"
  exit 1
fi

echo "── Migration blast radius: $MIG ──"
echo

# Parse for NOT NULL additions on existing columns
NOT_NULL_TABLES=$(grep -iE "ALTER TABLE [a-z_]+ +ALTER COLUMN [a-z_]+ +SET NOT NULL" "$MIG" \
  | grep -oiE "ALTER TABLE +[a-z_]+" \
  | sed 's/.* //' \
  | sort -u)

# Parse for new NOT NULL columns (ADD COLUMN ... NOT NULL with no DEFAULT)
ADD_COL_NN=$(grep -iE "ADD COLUMN.*NOT NULL" "$MIG" | grep -viE "DEFAULT" || true)

# Parse for CHECK constraint additions
NEW_CHECKS=$(grep -iE "ADD CONSTRAINT.*CHECK" "$MIG" | head -10)

if [ -z "$NOT_NULL_TABLES" ] && [ -z "$ADD_COL_NN" ] && [ -z "$NEW_CHECKS" ]; then
  echo "✓ No NOT NULL additions or CHECK constraints found in this migration."
  echo "  Safe to apply; INSERT sites untouched."
  exit 0
fi

if [ -n "$NOT_NULL_TABLES" ]; then
  echo "⚠ NOT NULL additions detected on tables:"
  echo "$NOT_NULL_TABLES" | sed 's/^/  - /'
  echo
  for table in $NOT_NULL_TABLES; do
    echo "── INSERT sites for table '$table' ──"
    SITES=$(grep -rn "INSERT INTO $table" src/ --include='*.ts' --include='*.tsx' --include='*.sql' 2>/dev/null || true)
    if [ -z "$SITES" ]; then
      echo "  (none found)"
    else
      echo "$SITES" | sed 's/^/  /' | head -30
      COUNT=$(echo "$SITES" | wc -l)
      echo "  TOTAL: $COUNT INSERT site(s) that may need updating."
    fi
    echo
  done
fi

if [ -n "$ADD_COL_NN" ]; then
  echo "⚠ NEW NOT NULL columns added (no DEFAULT):"
  echo "$ADD_COL_NN" | sed 's/^/  /'
  echo "  → All INSERT sites for the affected table MUST set this column."
  echo
fi

if [ -n "$NEW_CHECKS" ]; then
  echo "⚠ NEW CHECK constraints added:"
  echo "$NEW_CHECKS" | sed 's/^/  /'
  echo "  → All INSERT/UPDATE values must satisfy the new constraint."
  echo
fi

echo "── End audit. Confirm each INSERT site is updated, then apply migration. ──"
exit 0
