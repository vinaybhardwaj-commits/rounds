import { neon } from '@neondatabase/serverless';

// Lazy-init: only create the Neon connection at runtime (not during build)
// This prevents "neon() called with undefined" errors during Next.js static analysis
let _sql: ReturnType<typeof neon> | null = null;

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) {
    _sql = neon(process.env.POSTGRES_URL!);
  }
  return _sql(strings, ...values);
}

// Helper: execute a parameterized query and return rows
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  if (!_sql) {
    _sql = neon(process.env.POSTGRES_URL!);
  }
  const result = await _sql(text, params as never[]) as Record<string, unknown>[];
  return result as T[];
}

// Helper: execute a query and return first row or null
export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  if (!_sql) {
    _sql = neon(process.env.POSTGRES_URL!);
  }
  const result = await _sql(text, params as never[]) as Record<string, unknown>[];
  return (result[0] as T) ?? null;
}

// Helper: execute a mutation (INSERT/UPDATE/DELETE) and return row count
export async function execute(text: string, params?: unknown[]): Promise<number> {
  if (!_sql) {
    _sql = neon(process.env.POSTGRES_URL!);
  }
  const result = await _sql(text, params as never[]) as Record<string, unknown>[];
  return result.length;
}
