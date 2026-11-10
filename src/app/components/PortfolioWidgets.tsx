import { useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Flame, Globe2, PieChart, Sparkles, Wallet2 } from 'lucide-react';
import type { Altseason, FearGreed, GlobalStats } from '../services/marketService';
import { formatCompactUsd, formatPct, formatUsd, sparklinePath } from '../lib/format';

function Delta({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-zinc-500">No change data</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? <ArrowUpRight className="w-3 h-3" aria-hidden /> : <ArrowDownRight className="w-3 h-3" aria-hidden />}
      {formatPct(value)}
    </span>
  );
}

function Widget({ title, icon, children, footer }: { title: string; icon: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 hover:border-zinc-700/70 transition-colors flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <p className="text-zinc-500 text-xs font-medium">{title}</p>
        <div className="w-6 h-6 rounded-md bg-zinc-800/80 flex items-center justify-center text-zinc-400">{icon}</div>
      </div>
      {children}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

const Skeleton = () => <div className="h-7 w-24 rounded bg-zinc-800 animate-pulse" aria-label="Loading" />;

function Spark({ series, color }: { series: number[]; color: string }) {
  const path = sparklinePath(series);
  if (!path) return null;
  return (
    <svg viewBox="0 0 170 36" className="w-full h-8" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PortfolioValueWidget({ value, change, sourceLabel, hint }: { value: number | null; change: number | null; sourceLabel: string; hint?: ReactNode }) {
  return (
    <Widget title={`Portfolio value`} icon={<Wallet2 className="w-4 h-4" />} footer={<p className="text-[11px] text-zinc-500">{hint ?? sourceLabel}</p>}>
      <p className="text-white text-xl font-bold tracking-tight tabular-nums">{value == null ? <Skeleton /> : formatUsd(value)}</p>
      <Delta value={change} />
      <p className="text-[11px] text-violet-300 mt-1">{sourceLabel}</p>
    </Widget>
  );
}

export function AltseasonWidget({ data }: { data: Altseason | null | undefined }) {
  const color = !data ? 'bg-zinc-700' : data.index >= 75 ? 'bg-emerald-500' : data.index >= 50 ? 'bg-amber-500' : 'bg-blue-500';
  const label = !data ? '' : data.index >= 75 ? 'Altseason' : data.index >= 50 ? 'Alts gaining' : data.index > 25 ? 'Bitcoin leads' : 'Bitcoin season';
  return (
    <Widget title="Altseason index" icon={<Sparkles className="w-4 h-4" />} footer={<p className="text-[11px] text-zinc-500">{data ? data.basis : 'Calculating from live data'}</p>}>
      <p className="text-white text-xl font-bold tabular-nums">{data ? `${data.index}/100` : <Skeleton />}</p>
      <p className="text-xs text-zinc-400">{label}</p>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-2" role="progressbar" aria-valuenow={data?.index ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Altseason index">
        <div className={`h-full ${color}`} style={{ width: `${data?.index ?? 0}%` }} />
      </div>
    </Widget>
  );
}

const COINS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'OTHERS'] as const;

export function DominanceWidget({ global }: { global: GlobalStats | null | undefined }) {
  const [active, setActive] = useState<(typeof COINS)[number]>('BTC');
  const value = global?.dominance[active] ?? 0;
  return (
    <Widget title="Market dominance" icon={<PieChart className="w-3.5 h-3.5" />}>
      <div className="flex flex-wrap gap-1 mb-2.5">
        {COINS.map((c) => (
          <button
            key={c} onClick={() => setActive(c)} aria-pressed={active === c}
            className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${active === c ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{active}</span>
        <span className="text-white font-semibold tabular-nums">{global ? `${value.toFixed(1)}%` : '...'}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-1.5">
        <div className="h-full bg-cyan-400" style={{ width: `${value}%` }} />
      </div>
    </Widget>
  );
}

export function MarketCapWidget({ global, trend }: { global: GlobalStats | null | undefined; trend: number[] }) {
  return (
    <Widget title="Total market cap" icon={<Globe2 className="w-4 h-4" />} footer={trend.length > 2 ? <Spark series={trend} color="#22c55e" /> : undefined}>
      <p className="text-white text-xl font-bold tabular-nums">{global ? formatCompactUsd(global.totalMarketCapUsd) : <Skeleton />}</p>
      <Delta value={global?.marketCapChange24hPct} />
      {trend.length > 2 && <p className="text-[11px] text-zinc-500 mt-1">Top 10 coins, last 7 days</p>}
    </Widget>
  );
}

export function FearGreedWidget({ data }: { data: FearGreed | null | undefined }) {
  const v = data?.value ?? 0;
  const tone = v >= 75 ? 'text-emerald-400' : v >= 55 ? 'text-green-400' : v >= 45 ? 'text-amber-400' : v >= 25 ? 'text-orange-400' : 'text-red-400';
  return (
    <Widget title="Fear and Greed" icon={<Flame className="w-4 h-4" />} footer={data && data.history.length > 2 ? <Spark series={data.history.map((p) => p.value)} color="#f59e0b" /> : undefined}>
      <p className="text-white text-xl font-bold tabular-nums">{data ? `${data.value}/100` : <Skeleton />}</p>
      <p className={`text-xs font-medium ${tone}`}>{data?.label ?? ''}</p>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-2" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="Fear and Greed index">
        <div className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500" style={{ width: `${v}%` }} />
      </div>
      {data && data.history.length > 2 && <p className="text-[11px] text-zinc-500 mt-1">Last 30 days</p>}
    </Widget>
  );
}
