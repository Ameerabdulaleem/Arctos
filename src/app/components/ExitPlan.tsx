import { Browsers, CheckCircle, CloudCheck, ShieldWarning, Target, TrendDown, UserCircle, WifiSlash } from '@phosphor-icons/react';
import { Card, IconTile, Pill, Switch } from './ui/common';
import type { KeeperStatus } from '../contexts/paper-context';
import { allocation, describePlan, DEFAULT_EXIT, MAX_GAIN_PCT, type ExitSettings, type TakeProfitLevel } from '../lib/exitPlan';
import type { MarkedPosition } from '../lib/paperTrading';
import { keeperStateOf } from '../services/keeperService';
import { formatCompactUsd, formatPct, formatUsd, pnlClass, timeAgo } from '../lib/format';

const LEVEL_BAR = ['bg-emerald-400', 'bg-blue-300', 'bg-violet-400'];
const LEVEL_DOT = ['bg-emerald-400', 'bg-blue-300', 'bg-violet-400'];
/** Background checks older than this, with snipes open, mean the schedule has stopped. */
const STALLED_AFTER_MS = 20 * 60_000;

function PercentField({ id, label, value, max, onChange }: { id: string; label: string; value: number; max: number; onChange: (next: number) => void }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="eyebrow text-[10px]">{label}</span>
      <span className="relative mt-1 block">
        <input
          id={id} type="number" inputMode="decimal" min={0} max={max} step="any" value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, n)));
          }}
          className="field num py-2 pl-3 pr-7"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500" aria-hidden>%</span>
      </span>
    </label>
  );
}

function TakeProfitTile({ index, level, onChange }: { index: number; level: TakeProfitLevel; onChange: (next: TakeProfitLevel) => void }) {
  const n = index + 1;
  const live = level.enabled && level.gainPct > 0 && level.sellPct > 0;
  return (
    <fieldset className={`panel-inset min-w-0 p-3 transition ${level.enabled ? '' : 'opacity-55'}`}>
      <legend className="sr-only">Take profit {n}</legend>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><span className={`h-2 w-2 rounded-full ${LEVEL_DOT[index]}`} aria-hidden />TP{n}</span>
        <Switch checked={level.enabled} onChange={(enabled) => onChange({ ...level, enabled })} label={`Take profit ${n}`} />
      </div>
      <div className="space-y-2">
        <PercentField id={`tp${n}-gain`} label="At profit" value={level.gainPct} max={MAX_GAIN_PCT} onChange={(gainPct) => onChange({ ...level, gainPct })} />
        <PercentField id={`tp${n}-sell`} label="Sell" value={level.sellPct} max={100} onChange={(sellPct) => onChange({ ...level, sellPct })} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-zinc-500">
        {!level.enabled ? 'Off' : live ? `Sells ${level.sellPct}% at +${level.gainPct}%` : 'Set both numbers above zero'}
      </p>
    </fieldset>
  );
}

/** Tells the trader, in plain words, whether their snipes are looked after while they are away. */
function KeeperNote({ keeper, capability, openCount }: { keeper: KeeperStatus; capability: { offline: boolean; durable: boolean } | null; openCount: number }) {
  const offline = keeper.mode ? keeper.mode === 'offline' : capability?.offline;
  const durable = keeper.mode ? keeper.durable : capability?.durable;
  const box = 'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed';
  if (keeper.error) {
    return (
      <p role="alert" className={`${box} border-rose-400/25 bg-rose-400/[0.07] text-rose-200`}>
        <WifiSlash className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Open snipes are not being managed right now. {keeper.error} Arctos keeps trying.</span>
      </p>
    );
  }
  if (offline == null) return null;
  if (!offline) {
    return (
      <p role="status" className={`${box} border-amber-400/25 bg-amber-400/[0.07] text-amber-100`}>
        <Browsers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Managed while Arctos is open.</strong> Keep one tab open, on any page, and your targets, stop loss and guard are checked every few seconds.
          With every tab closed nothing is checked. Connecting a database to the site turns on management around the clock.
        </span>
      </p>
    );
  }
  const last = keeper.lastBackgroundCheck;
  // Measured against the moment the keeper last answered, which is when `last` was read.
  const stalled = durable && openCount > 0 && keeper.mode === 'offline' && last != null && keeper.syncedAt != null && keeper.syncedAt - last > STALLED_AFTER_MS;
  if (stalled) {
    return (
      <p role="status" className={`${box} border-amber-400/25 bg-amber-400/[0.07] text-amber-100`}>
        <Browsers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Background checks have stalled.</strong> The last one ran {timeAgo(last)}. Until the schedule runs again, your snipes are managed only while Arctos is open.
        </span>
      </p>
    );
  }
  return (
    <p role="status" className={`${box} border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100`}>
      <CloudCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Managed around the clock.</strong> Open snipes keep following this plan with Arctos closed
        {durable ? '' : ', for as long as the data service keeps running'}.
        {last != null && openCount > 0 ? ` Last background check ${timeAgo(last)}.` : ''} Sales made while you were away are booked the next time you open Arctos.
      </span>
    </p>
  );
}

export function ExitPlanCard({ exit, onChange, keeper, capability, openCount, bare = false }: {
  exit: ExitSettings; onChange: (next: ExitSettings) => void; keeper: KeeperStatus;
  capability: { offline: boolean; durable: boolean } | null; openCount: number;
  /** Inside a section that already has its own frame and title. */
  bare?: boolean;
}) {
  const Frame = bare ? 'div' : Card;
  const split = allocation(exit);
  const setLevel = (index: number, level: TakeProfitLevel) => {
    const takeProfits = [...exit.takeProfits] as ExitSettings['takeProfits'];
    takeProfits[index] = level;
    onChange({ ...exit, takeProfits });
  };
  return (
    <Frame className={bare ? '' : 'p-5'}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {!bare && <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Target /></IconTile>Exit plan</h2>}
          <p className="mt-1.5 text-xs text-zinc-500">How every snipe is sold. A change here also applies to the snipes you already hold.</p>
        </div>
        <button onClick={() => onChange(DEFAULT_EXIT)} className="text-xs text-zinc-400 hover:text-white">Reset exit plan</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <p className="eyebrow mb-2">Take profit targets</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {exit.takeProfits.map((level, i) => <TakeProfitTile key={i} index={i} level={level} onChange={(next) => setLevel(i, next)} />)}
          </div>
          <div className="mt-3.5">
            <div
              className="flex h-2 overflow-hidden rounded-full bg-white/[0.07]" role="img"
              aria-label={`The targets sell ${split.soldPct.toFixed(0)} percent of the position. ${split.ridingPct.toFixed(0)} percent keeps riding.`}
            >
              {split.perLevel.map((pct, i) => (pct > 0 ? <div key={i} className={LEVEL_BAR[i]} style={{ width: `${pct}%` }} /> : null))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              {split.perLevel.map((pct, i) => (pct > 0 ? <span key={i} className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[i]}`} aria-hidden />TP{i + 1} sells <span className="num text-zinc-200">{Number(pct.toFixed(2))}%</span></span> : null))}
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-white/25" aria-hidden />Keeps riding <span className="num text-zinc-200">{Number(split.ridingPct.toFixed(2))}%</span></span>
            </div>
            <p className={`mt-2 text-xs ${split.over ? 'text-amber-200' : 'text-zinc-400'}`}>{describePlan(exit)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="eyebrow">Cutting losses</p>
          <div className="panel-inset flex items-start gap-3 p-3">
            <IconTile tone="rose" size="sm"><TrendDown /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">Stop loss</p>
              <p className="mb-2 text-[11px] leading-snug text-zinc-500">Sells everything when the price is this far below what you paid. 0 turns it off.</p>
              <div className="max-w-[9rem]">
                <PercentField id="stop-loss" label="Loss" value={exit.stopLossPct} max={100} onChange={(stopLossPct) => onChange({ ...exit, stopLossPct })} />
              </div>
            </div>
          </div>
          <div className="panel-inset flex items-start gap-3 p-3">
            <IconTile tone="amber" size="sm"><ShieldWarning /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">Developer exit guard</p>
              <p className="text-[11px] leading-snug text-zinc-500">
                Sells everything when the developer starts unloading: their share of supply drops by a quarter or more after you buy, or about a third of the pool's liquidity is pulled out.
              </p>
            </div>
            <Switch checked={exit.devExit} onChange={(devExit) => onChange({ ...exit, devExit })} label="Developer exit guard" />
          </div>
        </div>
      </div>

      <div className="mt-4"><KeeperNote keeper={keeper} capability={capability} openCount={openCount} /></div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
        Sales are simulated at the price seen when a check runs, so a fast move can fill past a target. The guard reads the developer wallet about once a minute per token and cannot see every way a developer can leave.
      </p>
    </Frame>
  );
}

function GuardLine({ position }: { position: MarkedPosition }) {
  const guard = keeperStateOf(position)?.guard;
  if (!guard) return <p className="text-[11px] text-zinc-600">Waiting for the first check.</p>;
  const parts: string[] = [];
  if (guard.devBasePct != null && guard.devNowPct != null) {
    parts.push(guard.devNowPct < guard.devBasePct - 0.05
      ? `Developer holds ${guard.devNowPct.toFixed(1)}%, down from ${guard.devBasePct.toFixed(1)}%`
      : `Developer holds ${guard.devNowPct.toFixed(1)}%`);
  } else {
    parts.push(guard.devCheckedAt ? 'Developer wallet not known' : 'Developer check pending');
  }
  if (guard.liqRemovedPct != null && guard.liqRemovedPct >= 5) parts.push(`${guard.liqRemovedPct.toFixed(0)}% of liquidity withdrawn`);
  const worried = (guard.devSoldPct ?? 0) >= 10 || (guard.liqRemovedPct ?? 0) >= 10;
  return (
    <p className={`flex items-center gap-1.5 text-[11px] ${worried ? 'text-amber-200' : 'text-zinc-500'}`}>
      <UserCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />{parts.join(' · ')}
    </p>
  );
}

/** One open snipe: profit, how much is left, where it stands on the ladder and who is watching it. */
export function OpenSnipe({ position, exit, rejected, onSell }: { position: MarkedPosition; exit: ExitSettings; rejected?: string; onSell: () => void }) {
  const state = keeperStateOf(position);
  const done = new Set(state?.tpDone ?? []);
  const leftPct = state && state.basisQty > 0 ? Math.min(100, (position.qty / state.basisQty) * 100) : 100;
  const liquidity = state?.last?.liquidityUsd;
  return (
    <li className="panel-inset p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-white">{position.symbol}</span>
        <span className={`num shrink-0 font-semibold ${pnlClass(position.unrealizedPnl)}`}>{position.unrealizedPct == null ? 'Waiting for price' : formatPct(position.unrealizedPct)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="num">{formatUsd(position.value)}{leftPct < 99.9 ? ` · ${leftPct.toFixed(0)}% left` : ''}{liquidity ? ` · ${formatCompactUsd(liquidity)} liquidity` : ''}</span>
        <button onClick={onSell} className="shrink-0 text-rose-300 hover:text-rose-200">Sell all</button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Exit plan progress">
        {exit.takeProfits.map((level, i) => {
          const hit = done.has(i + 1);
          if (!hit && !(level.enabled && level.gainPct > 0 && level.sellPct > 0)) return null;
          return (
            <li key={i} className={`chip ${hit ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200' : ''}`}>
              {hit && <CheckCircle className="h-3 w-3" weight="fill" aria-hidden />}TP{i + 1} {hit ? 'sold' : `+${level.gainPct}%`}
            </li>
          );
        })}
        {exit.stopLossPct > 0 && <li className="chip">Stop -{exit.stopLossPct}%</li>}
        {exit.devExit && <li className="chip">Guard on</li>}
      </ul>
      {exit.devExit && <div className="mt-2"><GuardLine position={position} /></div>}
      <div className="mt-2">
        {rejected ? <Pill tone="red">Not managed. {rejected}</Pill>
          : state?.offline ? <Pill tone="green"><CloudCheck className="h-3 w-3" aria-hidden />Managed around the clock</Pill>
          : <Pill tone="zinc"><Browsers className="h-3 w-3" aria-hidden />Managed while Arctos is open</Pill>}
      </div>
    </li>
  );
}
