import { describe, expect, it } from 'vitest';
import { DEFAULT_EXIT, activeLevels, allocation, describePlan, fromLegacy, sanitizeExit, toPlan, type ExitSettings } from './exitPlan';

const plan = (overrides: Partial<ExitSettings> = {}): ExitSettings => ({ ...DEFAULT_EXIT, ...overrides });
const level = (enabled: boolean, gainPct: number, sellPct: number) => ({ enabled, gainPct, sellPct });

describe('exit plan', () => {
  it('starts with three targets that sell the whole position between them', () => {
    expect(toPlan(DEFAULT_EXIT)).toEqual({
      takeProfits: [{ level: 1, gainPct: 80, sellPct: 60 }, { level: 2, gainPct: 400, sellPct: 20 }, { level: 3, gainPct: 1000, sellPct: 20 }],
      stopLossPct: 20,
      devExit: true,
    });
    expect(allocation(DEFAULT_EXIT)).toEqual({ soldPct: 100, ridingPct: 0, over: false, perLevel: [60, 20, 20] });
  });

  it('lets a single target stand alone and keeps its number', () => {
    const only2 = plan({ takeProfits: [level(false, 80, 60), level(true, 300, 50), level(false, 1000, 20)] });
    expect(activeLevels(only2)).toEqual([{ level: 2, gainPct: 300, sellPct: 50 }]);
    expect(allocation(only2)).toMatchObject({ soldPct: 50, ridingPct: 50, perLevel: [0, 50, 0] });
    expect(describePlan(only2)).toBe('50% keeps riding after the last target, until the stop loss, the developer guard or a manual sell.');
  });

  it('ignores a target with a zero in it, and sends no stop loss when it is zero', () => {
    const p = plan({ takeProfits: [level(true, 0, 60), level(true, 400, 0), level(true, 1000, 100)], stopLossPct: 0, devExit: false });
    expect(toPlan(p)).toEqual({ takeProfits: [{ level: 3, gainPct: 1000, sellPct: 100 }], stopLossPct: null, devExit: false });
  });

  it('shares out the position in order of gain when the targets ask for too much', () => {
    // TP2 fires before TP1 here because its gain is lower.
    const p = plan({ takeProfits: [level(true, 500, 70), level(true, 100, 70), level(false, 0, 0)] });
    expect(allocation(p)).toEqual({ soldPct: 100, ridingPct: 0, over: true, perLevel: [30, 70, 0] });
    expect(describePlan(p)).toContain('more than 100%');
  });

  it('says so when nothing will sell automatically', () => {
    const off = [level(false, 80, 60), level(false, 400, 20), level(false, 1000, 20)] as ExitSettings['takeProfits'];
    expect(describePlan(plan({ takeProfits: off }))).toContain('No take profit is set');
    expect(describePlan(plan({ takeProfits: off, stopLossPct: 0, devExit: false }))).toContain('Nothing will sell automatically');
    expect(describePlan(DEFAULT_EXIT)).toBe('The whole position is sold across 3 targets.');
  });

  it('rebuilds stored settings and falls back on anything unusable', () => {
    expect(sanitizeExit(JSON.parse(JSON.stringify(DEFAULT_EXIT)))).toEqual(DEFAULT_EXIT);
    expect(sanitizeExit(null)).toEqual(DEFAULT_EXIT);
    expect(sanitizeExit({ takeProfits: 'all', stopLossPct: 'none', devExit: 'yes' })).toEqual(DEFAULT_EXIT);
    const odd = sanitizeExit({ takeProfits: [{ enabled: false, gainPct: -5, sellPct: 250 }, { gainPct: 150, sellPct: 40 }], stopLossPct: 35, devExit: false });
    expect(odd.takeProfits[0]).toEqual({ enabled: false, gainPct: 80, sellPct: 60 });
    expect(odd.takeProfits[1]).toEqual({ enabled: true, gainPct: 150, sellPct: 40 });
    expect(odd.takeProfits[2]).toEqual(DEFAULT_EXIT.takeProfits[2]);
    expect([odd.stopLossPct, odd.devExit]).toEqual([35, false]);
  });

  it('turns the old single take profit into a first target that sells everything', () => {
    const old = fromLegacy({ takeProfitPct: 60, stopLossPct: 15 });
    expect(toPlan(old)).toEqual({ takeProfits: [{ level: 1, gainPct: 60, sellPct: 100 }], stopLossPct: 15, devExit: true });
    expect(activeLevels(fromLegacy({ takeProfitPct: 0, stopLossPct: 0 }))).toEqual([]);
    expect(fromLegacy({})).toEqual(DEFAULT_EXIT);
  });
});
