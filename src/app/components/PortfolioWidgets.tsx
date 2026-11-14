import { useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, ChartPieSlice, Fire, GlobeHemisphereWest, Sparkle, Wallet } from '@phosphor-icons/react';
import type { Altseason, FearGreed, GlobalStats } from '../services/marketService';
import { formatCompactUsd, formatPct, formatUsd, sparklinePath } from '../lib/format';
import { IconTile, Skeleton, type Tone } from './ui/common';

function Delta({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-zinc-500">No change data</span>;
  const up = value >= 0;
  return (
    <span className={`num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${up ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
      {up ? <ArrowUpRight className="h-3 w-3" weight="bold" aria-hidden /> : <ArrowDownRight className="h-3 w-3" weight="bold" aria-hidden />}
      {formatPct(value)}
    </span>
  );
}

function Widget({ title, icon, tone, children, footer }: { title: string; icon: ReactNode; tone: Tone; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="panel panel-hover flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-400">{title}</p>
        <IconTile tone={tone} size="sm">{icon}</IconTile>
      </div>
      {children}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );
}

const VALUE = 'num text-[26px] font-semibold leading-8 tracking-tight text-white';

function Spark({ series, color, id }: { series: number[]; color: string; id: string }) {
  const path = sparklinePath(series);
  if (!path) return null;
  return (
    <svg viewBox="0 0 170 36" className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L170,36 L0,36 Z`} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Meter({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${className}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PortfolioValueWidget({ value, change, sourceLabel, hint }: { value: number | null; change: number | null; sourceLabel: string; hint?: ReactNode }) {
  return (
    <Widget title="Portfolio value" tone="violet" icon={<Wallet />} footer={<p className="text-[11px] text-zinc-500">{hint ?? sourceLabel}</p>}>
      <p className={VALUE}>{value == null ? <Skeleton className="h-7 w-28" /> : formatUsd(value)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Delta value={change} />
        <span className="text-[11px] text-violet-300">{sourceLabel}</span>
      </div>
    </Widget>
  );
}

export function AltseasonWidget({ data }: { data: Altseason | null | undefined }) {
  const color = !data ? 'bg-zinc-700' : data.index >= 75 ? 'bg-emerald-400' : data.index >= 50 ? 'bg-amber-400' : 'bg-blue-400';
  const label = !data ? '' : data.index >= 75 ? 'Altseason' : data.index >= 50 ? 'Alts gaining' : data.index > 25 ? 'Bitcoin leads' : 'Bitcoin season';
  return (
    <Widget title="Altseason index" tone="amber" icon={<Sparkle />} footer={<p className="text-[11px] leading-relaxed text-zinc-500">{data ? data.basis : 'Calculating from live data'}</p>}>
      <p className={VALUE}>{data ? <>{data.index}<span className="text-base text-zinc-500">/100</span></> : <Skeleton className="h-7 w-20" />}</p>
      <p className="mt-0.5 text-xs text-zinc-300">{label}</p>
      <Meter value={data?.index ?? 0} label="Altseason index" className={color} />
    </Widget>
  );
}

const COINS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'OTHERS'] as const;

export function DominanceWidget({ global }: { global: GlobalStats | null | undefined }) {
  const [active, setActive] = useState<(typeof COINS)[number]>('BTC');
  const value = global?.dominance[active] ?? 0;
  return (
    <Widget title="Market dominance" tone="ice" icon={<ChartPieSlice />}>
      <p className={VALUE}>{global ? <>{value.toFixed(1)}<span className="text-base text-zinc-500">%</span></> : <Skeleton className="h-7 w-20" />}</p>
      <p className="mt-0.5 text-xs text-zinc-300">{active === 'OTHERS' ? 'All other coins' : `${active} share of the market`}</p>
      <Meter value={value} label={`${active} dominance`} className="bg-gradient-to-r from-blue-300 to-blue-500" />
      <div className="mt-3 flex flex-wrap gap-1">
        {COINS.map((c) => (
          <button
            key={c} onClick={() => setActive(c)} aria-pressed={active === c}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${active === c ? 'border-blue-300/40 bg-blue-400/15 text-blue-100' : 'border-white/[0.07] bg-white/[0.03] text-zinc-400 hover:text-zinc-100'}`}
          >
            {c}
          </button>
        ))}
      </div>
    </Widget>
  );
}

export function MarketCapWidget({ global, trend }: { global: GlobalStats | null | undefined; trend: number[] }) {
  const up = (global?.marketCapChange24hPct ?? 0) >= 0;
  return (
    <Widget
      title="Total market cap" tone="mint" icon={<GlobeHemisphereWest />}
      footer={trend.length > 2 ? <><Spark series={trend} color={up ? '#34d399' : '#fb7185'} id="spark-mcap" /><p className="mt-1 text-[11px] text-zinc-500">Top 10 coins, last 7 days</p></> : undefined}
    >
      <p className={VALUE}>{global ? formatCompactUsd(global.totalMarketCapUsd) : <Skeleton className="h-7 w-24" />}</p>
      <div className="mt-1.5"><Delta value={global?.marketCapChange24hPct} /></div>
    </Widget>
  );
}

export function FearGreedWidget({ data }: { data: FearGreed | null | undefined }) {
  const v = data?.value ?? 0;
  const tone = v >= 75 ? 'text-emerald-300' : v >= 55 ? 'text-emerald-300' : v >= 45 ? 'text-amber-300' : v >= 25 ? 'text-orange-300' : 'text-rose-300';
  return (
    <Widget
      title="Fear and Greed" tone="rose" icon={<Fire />}
      footer={data && data.history.length > 2 ? <><Spark series={data.history.map((p) => p.value)} color="#fbbf24" id="spark-fng" /><p className="mt-1 text-[11px] text-zinc-500">Last 30 days</p></> : undefined}
    >
      <p className={VALUE}>{data ? <>{data.value}<span className="text-base text-zinc-500">/100</span></> : <Skeleton className="h-7 w-20" />}</p>
      <p className={`mt-0.5 text-xs font-medium ${tone}`}>{data?.label ?? ''}</p>
      <Meter value={v} label="Fear and Greed index" className="bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400" />
    </Widget>
  );
}
