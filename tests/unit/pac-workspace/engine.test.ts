// =============================================================================
// PAC Workspace v2 — Engine behavior tests (PCW2.2a)
//
// Run: npx vitest run tests/unit/pac-workspace/engine.test.ts
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '@/lib/pac-workspace/engine';
import { defineRule } from '@/lib/pac-workspace/engine-types';
import { makeSnapshot } from './_fixtures';

describe('evaluate() — engine behavior', () => {
  it('returns empty array for empty rule set', () => {
    expect(evaluate(makeSnapshot(), [])).toEqual([]);
  });

  it('emits one SuggestionEvaluation per fired rule, preserving order', () => {
    const ruleA = defineRule({
      id: 'test.a', version: 1, layer: 1, severity: 'required',
      routesTo: 'diagnostic', sopReference: '§A',
      trigger: () => true,
      payload: () => ({ kind: 'diagnostic', orderType: 'lab.a', label: 'A' }),
      reason: () => 'reason A',
    });
    const ruleB = defineRule({
      id: 'test.b', version: 2, layer: 2, severity: 'recommended',
      routesTo: 'clearance', sopReference: '§B',
      trigger: () => true,
      payload: () => ({ kind: 'clearance', specialty: 'cardiology', label: 'Cardio' }),
      reason: () => 'reason B',
    });
    const out = evaluate(makeSnapshot(), [ruleA, ruleB]);
    expect(out).toHaveLength(2);
    expect(out[0].ruleId).toBe('test.a');
    expect(out[0].ruleVersion).toBe(1);
    expect(out[0].layer).toBe(1);
    expect(out[0].severity).toBe('required');
    expect(out[0].reason).toBe('reason A');
    expect(out[1].ruleId).toBe('test.b');
    expect(out[1].ruleVersion).toBe(2);
  });

  it('skips rules whose trigger returns false', () => {
    const ruleAlways = defineRule({
      id: 'test.always', version: 1, layer: 1, severity: 'info',
      routesTo: 'info_only', sopReference: '§A',
      trigger: () => true,
      payload: () => ({ kind: 'info_only', message: 'always' }),
      reason: () => 'always',
    });
    const ruleNever = defineRule({
      id: 'test.never', version: 1, layer: 1, severity: 'info',
      routesTo: 'info_only', sopReference: '§B',
      trigger: () => false,
      payload: () => ({ kind: 'info_only', message: 'never' }),
      reason: () => 'never',
    });
    const out = evaluate(makeSnapshot(), [ruleAlways, ruleNever]);
    expect(out.map((s) => s.ruleId)).toEqual(['test.always']);
  });

  it('skips a rule whose trigger throws (non-fatal — engine continues)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const buggy = defineRule({
      id: 'test.buggy', version: 1, layer: 1, severity: 'info',
      routesTo: 'info_only', sopReference: '§B',
      trigger: () => { throw new Error('predicate boom'); },
      payload: () => ({ kind: 'info_only', message: 'never' }),
      reason: () => 'never',
    });
    const ok = defineRule({
      id: 'test.ok', version: 1, layer: 1, severity: 'info',
      routesTo: 'info_only', sopReference: '§A',
      trigger: () => true,
      payload: () => ({ kind: 'info_only', message: 'ok' }),
      reason: () => 'ok',
    });
    const out = evaluate(makeSnapshot(), [buggy, ok]);
    expect(out.map((s) => s.ruleId)).toEqual(['test.ok']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('skips a rule whose payload throws even after trigger returned true', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = defineRule({
      id: 'test.broken_payload', version: 1, layer: 1, severity: 'required',
      routesTo: 'diagnostic', sopReference: '§B',
      trigger: () => true,
      payload: () => { throw new Error('payload boom'); },
      reason: () => 'reason',
    });
    const out = evaluate(makeSnapshot(), [broken]);
    expect(out).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('passes the snapshot through to trigger / payload / reason', () => {
    const seen: unknown[] = [];
    const rule = defineRule({
      id: 'test.snap', version: 1, layer: 1, severity: 'info',
      routesTo: 'info_only', sopReference: '§A',
      trigger: (s) => { seen.push(s); return true; },
      payload: (s) => { seen.push(s); return { kind: 'info_only', message: 'ok' }; },
      reason: (s) => { seen.push(s); return 'ok'; },
    });
    const snap = makeSnapshot({ asaGrade: 2 });
    evaluate(snap, [rule]);
    expect(seen).toHaveLength(3);
    expect(seen.every((s) => s === snap)).toBe(true);
  });

  it('preserves recencyWindowDays when set on the rule', () => {
    const rule = defineRule({
      id: 'test.recency', version: 1, layer: 1, severity: 'required',
      routesTo: 'diagnostic', sopReference: '§A',
      recencyWindowDays: 90,
      trigger: () => true,
      payload: () => ({ kind: 'diagnostic', orderType: 'lab.x', label: 'X' }),
      reason: () => 'r',
    });
    const out = evaluate(makeSnapshot(), [rule]);
    expect(out[0].recencyWindowDays).toBe(90);
  });
});
