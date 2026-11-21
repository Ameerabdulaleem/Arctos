import { CircleNotch, Lightning, Pause, Play } from '@phosphor-icons/react';
import { timeAgo } from '../../lib/format';
import type { AutoStrategy } from '../../lib/walletSnipes';
import { Card, IconTile } from '../ui/common';
import type { AutoEvent, ScanSummary } from './useAutoSniper';

const TONE: Record<AutoEvent['tone'], string> = {
  buy: 'text-emerald-300', sell: 'text-blue-300', skip: 'text-zinc-400', info: 'text-zinc-300', error: 'text-rose-300',
};

export function AutoSniperCard({ on, onToggle, canRun, whyNot, strategy, onStrategy, budget, events, summary, scanning }: {
  on: boolean;
  onToggle: () => void;
  canRun: boolean;
  whyNot?: string;
  strategy: AutoStrategy;
  onStrategy: (s: AutoStrategy) => void;
  /** The budget fields for the current mode. */
  budget: React.ReactNode;
  events: AutoEvent[];
  summary: ScanSummary | null;
  scanning: boolean;
}) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="amber" size="sm"><Lightning /></IconTile>Auto sniping</h2>
        <button type="button" onClick={onToggle} disabled={!canRun && !on} aria-pressed={on} title={whyNot} className={`btn h-10 px-5 ${on ? 'btn-buy' : 'btn-secondary'}`}>
          {on ? <Pause className="h-4 w-4" weight="fill" aria-hidden /> : <Play className="h-4 w-4" weight="fill" aria-hidden />}
          {on ? 'Auto sniping on' : 'Start auto sniping'}
        </button>
      </div>
      {!canRun && !on && whyNot && <p className="text-xs text-amber-200">{whyNot}</p>}

      <div role="radiogroup" aria-label="How tokens are picked" className="grid gap-2 sm:grid-cols-2">
        {([
          ['smart', 'Automatic filter', 'Picks for you from the launchpads, busiest pools and DexScreener lists: real liquidity, buyers in control, a clean contract, and never a token that already pumped hard or is dumping.'],
          ['filters', 'My filters', 'Buys only launchpad tokens that pass every filter you set below. Strict filters can mean long waits between buys.'],
        ] as const).map(([id, title, text]) => (
          <button key={id} type="button" role="radio" aria-checked={strategy === id} onClick={() => onStrategy(id)}
            className={`rounded-xl border p-3 text-left transition ${strategy === id ? 'border-blue-300/50 bg-blue-400/10' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/20'}`}>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-[11px] leading-snug text-zinc-400">{text}</p>
          </button>
        ))}
      </div>

      {budget}

      {summary && (
        <div className="panel-inset space-y-1 p-3 text-xs">
          <p className="flex items-center gap-1.5 text-zinc-300">
            {scanning && <CircleNotch className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Last scan {timeAgo(summary.at)}: {summary.scanned} tokens, {summary.passed} passed{summary.best ? `, best ${summary.best.symbol}` : ''}.
          </p>
          {summary.skipped.length > 0 && <p className="text-zinc-500">Skipped: {summary.skipped.map(([why, n]) => `${n} ${why}`).join(', ')}.</p>}
        </div>
      )}

      {events.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs" aria-label="Auto sniper activity">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2"><span className="num shrink-0 text-zinc-600">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className={TONE[e.tone]}>{e.text}</span></li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-zinc-500">Scans every 30 seconds while this page is open. No filter can promise winning trades: most new tokens lose value, so keep the budget to what you can afford to lose.</p>
    </Card>
  );
}
