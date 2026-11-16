// The exit plan for sniper trades: up to three take profit targets, a stop loss and the
// developer exit guard. Pure helpers plus storage. The plan is evaluated by the data service
// (see backend/src/keeper.rs), never here, so there is one set of rules.

export interface TakeProfitLevel {
  enabled: boolean;
  /** Gain on the entry price that triggers the sale, in percent. */
  gainPct: number;
  /** Share of the position to sell, in percent. */
  sellPct: number;
}

export interface ExitSettings {
  /** TP1, TP2 and TP3, in that order. */
  takeProfits: [TakeProfitLevel, TakeProfitLevel, TakeProfitLevel];
  /** Sell everything at this loss, in percent. 0 turns it off. */
  stopLossPct: number;
  /** Sell everything when the developer is seen leaving. */
  devExit: boolean;
}

/** The plan in the shape the data service takes. Only switched on targets are sent. */
export interface KeeperPlan {
  takeProfits: Array<{ level: number; gainPct: number; sellPct: number }>;
  stopLossPct: number | null;
  devExit: boolean;
}

export const MAX_GAIN_PCT = 100_000;

export const DEFAULT_EXIT: ExitSettings = {
  takeProfits: [
    { enabled: true, gainPct: 80, sellPct: 60 },
    { enabled: true, gainPct: 400, sellPct: 20 },
    { enabled: true, gainPct: 1000, sellPct: 20 },
  ],
  stopLossPct: 20,
  devExit: true,
};

const EXIT_KEY = 'arctos_sniper_exit_v1';
const LEGACY_FILTERS_KEY = 'arctos_sniper_filters_v2';
/** Fired on this window when the plan is saved, so open trades pick it up straight away. */
export const EXIT_CHANGED_EVENT = 'arctos:exit-plan';

const bounded = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

/** Rebuilds settings from untrusted stored JSON. Anything unusable falls back to the default. */
export function sanitizeExit(raw: unknown): ExitSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const levels = Array.isArray(r.takeProfits) ? r.takeProfits : [];
  const takeProfits = DEFAULT_EXIT.takeProfits.map((fallback, i) => {
    const l = (levels[i] && typeof levels[i] === 'object' ? levels[i] : {}) as Record<string, unknown>;
    return {
      enabled: typeof l.enabled === 'boolean' ? l.enabled : fallback.enabled,
      gainPct: bounded(l.gainPct, MAX_GAIN_PCT) ?? fallback.gainPct,
      sellPct: bounded(l.sellPct, 100) ?? fallback.sellPct,
    };
  }) as ExitSettings['takeProfits'];
  return {
    takeProfits,
    stopLossPct: bounded(r.stopLossPct, 100) ?? DEFAULT_EXIT.stopLossPct,
    devExit: typeof r.devExit === 'boolean' ? r.devExit : DEFAULT_EXIT.devExit,
  };
}

/** Settings for someone who used the old single take profit: it becomes TP1 selling everything. */
export function fromLegacy(legacy: { takeProfitPct?: unknown; stopLossPct?: unknown }): ExitSettings {
  const tp = bounded(legacy.takeProfitPct, MAX_GAIN_PCT);
  const sl = bounded(legacy.stopLossPct, 100);
  if (tp === null && sl === null) return DEFAULT_EXIT;
  const off = (l: TakeProfitLevel): TakeProfitLevel => ({ ...l, enabled: false });
  const [one, two, three] = DEFAULT_EXIT.takeProfits;
  return {
    takeProfits: tp === null ? DEFAULT_EXIT.takeProfits : [{ enabled: tp > 0, gainPct: tp > 0 ? tp : one.gainPct, sellPct: 100 }, off(two), off(three)],
    stopLossPct: sl ?? DEFAULT_EXIT.stopLossPct,
    devExit: DEFAULT_EXIT.devExit,
  };
}

export function loadExit(): ExitSettings {
  try {
    const raw = localStorage.getItem(EXIT_KEY);
    if (raw) return sanitizeExit(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_FILTERS_KEY);
    if (legacy) return fromLegacy(JSON.parse(legacy) as Record<string, unknown>);
  } catch {
    /* fall through */
  }
  return DEFAULT_EXIT;
}

export function saveExit(settings: ExitSettings): void {
  try {
    localStorage.setItem(EXIT_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(EXIT_CHANGED_EVENT));
}

/** A target only counts when it is switched on and both of its numbers are above zero. */
export function activeLevels(settings: ExitSettings): Array<{ level: number; gainPct: number; sellPct: number }> {
  return settings.takeProfits
    .map((l, i) => ({ level: i + 1, gainPct: l.gainPct, sellPct: l.sellPct, enabled: l.enabled }))
    .filter((l) => l.enabled && l.gainPct > 0 && l.sellPct > 0)
    .map(({ level, gainPct, sellPct }) => ({ level, gainPct, sellPct }));
}

export function toPlan(settings: ExitSettings): KeeperPlan {
  return {
    takeProfits: activeLevels(settings),
    stopLossPct: settings.stopLossPct > 0 ? settings.stopLossPct : null,
    devExit: settings.devExit,
  };
}

export interface Allocation {
  /** Share of the position the targets sell between them, capped at 100. */
  soldPct: number;
  /** Share left to ride after every target has been hit. */
  ridingPct: number;
  /** True when the targets ask for more than the whole position. */
  over: boolean;
  /** What each of TP1 to TP3 really sells once earlier targets have taken their share. */
  perLevel: [number, number, number];
}

/** How the targets split the position, taking them in order of their gain as the keeper does. */
export function allocation(settings: ExitSettings): Allocation {
  const perLevel: [number, number, number] = [0, 0, 0];
  let left = 100;
  let asked = 0;
  for (const l of [...activeLevels(settings)].sort((a, b) => a.gainPct - b.gainPct)) {
    asked += l.sellPct;
    const take = Math.min(l.sellPct, left);
    perLevel[l.level - 1] = take;
    left -= take;
  }
  return { soldPct: 100 - left, ridingPct: left, over: asked > 100 + 1e-9, perLevel };
}

/** A plain sentence describing what the plan will do, for the summary under the targets. */
export function describePlan(settings: ExitSettings): string {
  const levels = activeLevels(settings);
  if (levels.length === 0) {
    return settings.stopLossPct > 0 || settings.devExit
      ? 'No take profit is set. The position is held until the stop loss, the developer guard or a manual sell.'
      : 'Nothing will sell automatically. You will have to sell by hand.';
  }
  const { ridingPct, over } = allocation(settings);
  if (over) return 'Your targets add up to more than 100%. The later targets sell whatever is left.';
  if (ridingPct < 0.01) return `The whole position is sold across ${levels.length === 1 ? 'one target' : `${levels.length} targets`}.`;
  const rest = settings.stopLossPct > 0 || settings.devExit ? 'the stop loss, the developer guard or a manual sell' : 'you sell by hand';
  return `${Number(ridingPct.toFixed(2))}% keeps riding after the last target, until ${rest}.`;
}
