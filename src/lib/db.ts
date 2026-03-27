import { neon } from '@neondatabase/serverless';

// Create the sql tagged-template function
// Uses POSTGRES_URL (set automatically by Vercel's Neon integration)
// fullResults: false returns rows as Record<string, unknown>[] directly
const sql = neon(process.env.POSTGRES_URL!);

export { sql };

// Helper: execute a parameterized query and return rows
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await sql(text, params as never[]) as Record<string, unknown>[];
  return result as T[];
}

// Helper: execute a query and return first row or null
export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const result = await sql(text, params as never[]) as Record<string, unknown>[];
  return (result[0] as T) ?? null;
}

// Helper: execute a mutation (INSERT/UPDATE/DELETE) and return row count
export async function execute(text: string, params?: unknown[]): Promise<number> {
  const result = await sql(text, params as never[]) as Record<string, unknown>[];
  return result.length;
}
