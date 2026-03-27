import { sql } from '@vercel/postgres';

// Re-export sql for direct use
export { sql };

// Helper: execute a query and return rows
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await sql.query(text, params);
  return result.rows as T[];
}

// Helper: execute a query and return first row or null
export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const result = await sql.query(text, params);
  return (result.rows[0] as T) ?? null;
}

// Helper: execute a mutation (INSERT/UPDATE/DELETE) and return row count
export async function execute(text: string, params?: unknown[]): Promise<number> {
  const result = await sql.query(text, params);
  return result.rowCount ?? 0;
}
