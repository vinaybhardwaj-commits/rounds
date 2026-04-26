// ============================================
// GET /api/admin/health
// System health check endpoint
// Checks LLM tunnel and database connectivity
// Protected: admin/super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { withApiTelemetry } from '@/lib/api-telemetry';
import { getCurrentUser } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

async function GET_inner() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const results: {
      status: 'healthy' | 'degraded' | 'down';
      latency_ms: number;
      timestamp: string;
      checks: {
        llm: { status: string; latency_ms: number; model: string | null };
        database: { status: string; latency_ms: number };
      };
    } = {
      status: 'healthy',
      latency_ms: 0,
      timestamp: new Date().toISOString(),
      checks: {
        llm: { status: 'unknown', latency_ms: 0, model: null },
        database: { status: 'unknown', latency_ms: 0 },
      },
    };

    // ── Check LLM Health ──
    const llmStart = Date.now();
    try {
      const llmBaseUrl = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').trim();
      const tagsUrl = llmBaseUrl.replace('/v1', '') + '/api/tags';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(tagsUrl, { signal: controller.signal });
      clearTimeout(timeout);

      const latency = Date.now() - llmStart;

      if (response.ok) {
        const data = await response.json();
        results.checks.llm = {
          status: 'healthy',
          latency_ms: latency,
          model: data.models?.[0]?.name || 'unknown',
        };
      } else {
        results.checks.llm = { status: 'degraded', latency_ms: latency, model: null };
        results.status = 'degraded';
      }
    } catch {
      results.checks.llm = { status: 'down', latency_ms: Date.now() - llmStart, model: null };
      results.status = 'degraded';
    }

    // ── Check Database Health ──
    const dbStart = Date.now();
    try {
      const sql = neon(process.env.POSTGRES_URL!);
      await sql('SELECT 1');
      results.checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
    } catch {
      results.checks.database = { status: 'down', latency_ms: Date.now() - dbStart };
      results.status = 'down';
    }

    // Overall LLM latency for the health bar
    results.latency_ms = results.checks.llm.latency_ms;

    const statusCode = results.status === 'down' ? 503 : 200;
    return NextResponse.json(results, { status: statusCode });
  } catch (error) {
    console.error('GET /api/admin/health error:', error);
    return NextResponse.json(
      { status: 'down', latency_ms: 0, timestamp: new Date().toISOString(), error: 'Health check failed' },
      { status: 503 }
    );
  }
}

// AP.3 — telemetry-wrapped exports (auto-applied)
export const GET = withApiTelemetry('/api/admin/health', GET_inner);
