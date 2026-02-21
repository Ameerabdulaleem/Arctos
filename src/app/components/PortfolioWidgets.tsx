import { type ReactNode, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Globe2, PieChart, Sparkles, Wallet2, Flame } from 'lucide-react';
import { DashboardMetrics, dashboardSyncService } from '../services/dashboardSyncService';

interface WidgetProps {
  title: string;
  value: string;
  delta: number;
  icon: ReactNode;
  children?: ReactNode;
}

const createSparklinePath = (series: number[], width = 170, height = 52): string => {
  if (!series.length) return '';

  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const step = width / Math.max(series.length - 1, 1);

  return series
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
};

function StatWidget({ title, value, delta, icon, children }: WidgetProps) {
  const isPositive = delta >= 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-400 text-sm">{title}</p>
        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300">{icon}</div>
      </div>
      <p className="text-white text-2xl font-bold tracking-tight">{value}</p>
      <div className={`mt-3 inline-flex items-center gap-1 text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
        {isPositive ? '+' : ''}
        {delta.toFixed(2)}%
      </div>
      {children && <div className="mt-4 relative z-10">{children}</div>}
    </div>
  );
}

interface MetricsProps {
  metrics: DashboardMetrics;
}

export function PortfolioValueWidget({ metrics }: MetricsProps) {
  return (
    <StatWidget
      title="Portfolio Value"
      value={dashboardSyncService.formatPortfolio(metrics.portfolioValue)}
      delta={metrics.portfolioChangePercent}
      icon={<Wallet2 className="w-4 h-4" />}
    />
  );
}

export function AltseasonIndexWidget({ metrics }: MetricsProps) {
  const progressColor =
    metrics.altseasonIndex >= 75
      ? 'bg-emerald-500'
      : metrics.altseasonIndex >= 50
        ? 'bg-amber-500'
        : 'bg-blue-500';
  const path = useMemo(() => createSparklinePath(metrics.altseasonTrend), [metrics.altseasonTrend]);

  return (
    <StatWidget
      title="Altseason Index"
      value={`${metrics.altseasonIndex}/100`}
      delta={metrics.altseasonIndex - 50}
      icon={<Sparkles className="w-4 h-4" />}
    >
      <div className="space-y-3">
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full ${progressColor}`} style={{ width: `${metrics.altseasonIndex}%` }} />
        </div>
        <svg viewBox="0 0 170 52" className="w-full h-12">
          <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </StatWidget>
  );
}

export function DominanceWidget({ metrics }: MetricsProps) {
  const [activeCoin, setActiveCoin] = useState<'BTC' | 'ETH' | 'USDT' | 'BNB' | 'SOL' | 'OTHERS'>('BTC');
  const coins: Array<'BTC' | 'ETH' | 'USDT' | 'BNB' | 'SOL' | 'OTHERS'> = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'OTHERS'];
  const activeValue = metrics.dominanceMap[activeCoin] ?? 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-400 text-sm">Market Dominance</p>
        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300">
          <PieChart className="w-4 h-4" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {coins.map((coin) => (
          <button
            key={coin}
            onClick={() => setActiveCoin(coin)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              activeCoin === coin
                ? 'bg-zinc-700 border-zinc-600 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {coin}
          </button>
        ))}
      </div>

      <div className="space-y-3 relative z-10">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">{activeCoin}</span>
          <span className="text-white font-semibold">{activeValue.toFixed(1)}%</span>
        </div>
        <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-cyan-400" style={{ width: `${activeValue}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
          <div className="bg-zinc-800/80 rounded p-2">
            <span className="block">BTC</span>
            <span className="text-zinc-200">{metrics.btcDominance.toFixed(1)}%</span>
          </div>
          <div className="bg-zinc-800/80 rounded p-2">
            <span className="block">ETH</span>
            <span className="text-zinc-200">{metrics.ethDominance.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketCapWidget({ metrics }: MetricsProps) {
  const path = useMemo(() => createSparklinePath(metrics.marketCapTrend), [metrics.marketCapTrend]);

  return (
    <StatWidget
      title="Total Market Cap"
      value={dashboardSyncService.formatMarketCap(metrics.totalMarketCap)}
      delta={metrics.marketCapChangePercent}
      icon={<Globe2 className="w-4 h-4" />}
    >
      <svg viewBox="0 0 170 52" className="w-full h-12">
        <path d={path} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </StatWidget>
  );
}

export function FearGreedWidget({ metrics }: MetricsProps) {
  const value = metrics.fearGreedIndex;

  const sentiment = value >= 75 ? 'Extreme Greed' : value >= 55 ? 'Greed' : value >= 45 ? 'Neutral' : value >= 25 ? 'Fear' : 'Extreme Fear';
  const sentimentColor =
    value >= 75
      ? 'text-emerald-400'
      : value >= 55
        ? 'text-green-400'
        : value >= 45
          ? 'text-amber-400'
          : value >= 25
            ? 'text-orange-400'
            : 'text-red-400';

  return (
    <StatWidget title="Fear / Greed Index" value={`${value}/100`} delta={value - 50} icon={<Flame className="w-4 h-4" />}>
      <div className="space-y-3">
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500" style={{ width: `${value}%` }} />
        </div>
        <p className={`text-sm font-medium ${sentimentColor}`}>{sentiment}</p>
      </div>
    </StatWidget>
  );
}
