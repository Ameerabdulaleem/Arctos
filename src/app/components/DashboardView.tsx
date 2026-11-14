import { useMemo } from 'react';
import { ArrowDownRight, ArrowsClockwise, ArrowSquareOut, ArrowUpRight, Clock, Lightning, Newspaper, Notebook, SquaresFour, Waves } from '@phosphor-icons/react';
import { AltseasonWidget, DominanceWidget, FearGreedWidget, MarketCapWidget, PortfolioValueWidget } from './PortfolioWidgets';
import { AssetTabs } from './AssetTabs';
import { Card, Empty, ErrorNotice, IconTile, Loading, PageHeader, Pill } from './ui/common';
import { useAuth } from '../contexts/auth-context';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { marketService } from '../services/marketService';
import { portfolioService } from '../services/portfolioService';
import { newsService } from '../services/newsService';
import { whaleService } from '../services/whaleService';
import { readTrades } from '../lib/tradebook';
import { formatCompactUsd, formatPct, formatPrice, formatUsd, pnlClass, safeHref, shortAddress, timeAgo } from '../lib/format';
import type { ViewId } from '../hooks/useHashView';

interface Props {
  onNavigate: (v: ViewId | null) => void;
  onConnectWallet: () => void;
}

export function DashboardView({ onNavigate, onConnectWallet }: Props) {
  const { user, isWalletConnected } = useAuth();
  const paper = usePaper();
  const address = isWalletConnected ? user?.walletAddress : undefined;

  const overview = usePolling((s) => marketService.overview(s), 30_000);
  const coins = usePolling((s) => marketService.coins(100, s), 60_000);
  const wallet = usePolling(
    (s) => (address ? portfolioService.get(address, s) : Promise.resolve(null)),
    address ? 30_000 : null,
    [address],
  );
  const news = usePolling((s) => newsService.list(5, s), 120_000);
  const whales = usePolling((s) => whaleService.list({ minUsd: 1_000_000, limit: 5 }, s), 30_000);

  const walletData = address ? wallet.data : null;
  const walletChange = useMemo(() => {
    if (!walletData) return null;
    const priced = walletData.holdings.filter((h) => h.valueUsd != null && h.change24h != null);
    const total = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
    if (total <= 0) return null;
    return priced.reduce((s, h) => s + ((h.valueUsd ?? 0) / total) * (h.change24h ?? 0), 0);
  }, [walletData]);

  const movers = useMemo(() => {
    const list = (coins.data?.coins ?? []).filter((c) => c.change24h != null);
    const sorted = [...list].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
    return { gainers: sorted.slice(0, 4), losers: sorted.slice(-4).reverse() };
  }, [coins.data]);

  const activity = useMemo(() => {
    const fills = paper.account.fills.slice(0, 8).map((f) => ({
      id: f.id, time: f.time, title: `${f.side === 'buy' ? 'Bought' : 'Sold'} ${f.symbol}`,
      detail: `${f.qty.toFixed(6)} at ${formatPrice(f.price)} (${f.note})`, value: f.qty * f.price, side: f.side, tag: 'Paper',
    }));
    const trades = readTrades().slice(0, 5).map((t) => ({
      id: t.id, time: Date.parse(t.date), title: `Logged ${t.tokenName}`,
      detail: `${t.amount} at ${formatPrice(Number(t.priceBought))}`, value: Number(t.priceBought) * Number(t.amount), side: 'buy' as const, tag: 'Trade book',
    }));
    return [...fills, ...trades].sort((a, b) => b.time - a.time).slice(0, 8);
  }, [paper.account.fills]);

  const loadingFirst = overview.loading && !overview.data;
  const g = overview.data?.global;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <PageHeader
        icon={<SquaresFour />} tone="ice" title="Dashboard" subtitle="Portfolio overview and market pulse, from live sources"
        actions={
          <>
            {overview.updatedAt && <span className="text-xs text-zinc-500">Updated {timeAgo(overview.updatedAt)}</span>}
            <button onClick={() => { overview.refresh(); coins.refresh(); wallet.refresh(); }} className="btn btn-secondary btn-sm h-9">
              <ArrowsClockwise className={`h-4 w-4 ${overview.loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
            </button>
          </>
        }
      />

      {overview.error && !overview.data && <ErrorNotice message={overview.error} onRetry={overview.refresh} />}
      {overview.error && overview.data && <ErrorNotice message={`Showing the last data we received. ${overview.error}`} onRetry={overview.refresh} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {address ? (
          <PortfolioValueWidget value={walletData?.totalUsd ?? null} change={walletChange} sourceLabel={`Wallet ${shortAddress(address)}`} hint={wallet.error && !walletData ? wallet.error : 'Live on chain balances'} />
        ) : (
          <PortfolioValueWidget value={paper.equity} change={paper.totalPnlPct} sourceLabel="Paper account" hint={<button onClick={onConnectWallet} className="text-blue-300 underline-offset-2 hover:text-blue-200 hover:underline">Connect a wallet for real balances</button>} />
        )}
        <AltseasonWidget data={loadingFirst ? undefined : overview.data?.altseason} />
        <DominanceWidget global={g} />
        <MarketCapWidget global={g} trend={overview.data?.marketCapTrend ?? []} />
        <FearGreedWidget data={overview.data?.fearGreed} />
      </div>

      <AssetTabs
        wallet={{ connected: Boolean(address), data: walletData, loading: wallet.loading, error: wallet.error, onConnect: onConnectWallet, onRetry: wallet.refresh }}
        coins={coins.data?.coins ?? null}
        paperPositions={paper.positions}
        onOpenTerminal={() => onNavigate('trading')}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="amber" size="sm"><Lightning /></IconTile>Top movers, 24h</h2>
            <button onClick={() => onNavigate('trading')} className="btn btn-ghost btn-sm text-blue-300">Trade <ArrowUpRight className="h-3 w-3" weight="bold" aria-hidden /></button>
          </div>
          {coins.loading && !coins.data ? <Loading /> : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Gainers', movers.gainers], ['Losers', movers.losers]].map(([title, list]) => (
                <div key={String(title)}>
                  <p className="eyebrow mb-2 text-[10px]">{String(title)}</p>
                  <ul className="space-y-1.5">
                    {(list as typeof movers.gainers).map((c) => (
                      <li key={c.id} className="panel-inset flex items-center justify-between px-3 py-2"><span className="font-medium text-zinc-100">{c.symbol}</span><span className={`num ${pnlClass(c.change24h)}`}>{formatPct(c.change24h)}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="ice" size="sm"><Waves /></IconTile>Whale transfers over $1M</h2>
            <button onClick={() => onNavigate('whale')} className="btn btn-ghost btn-sm text-blue-300">View all <ArrowUpRight className="h-3 w-3" weight="bold" aria-hidden /></button>
          </div>
          {whales.loading && !whales.data ? <Loading /> : whales.error && !whales.data ? <ErrorNotice message={whales.error} onRetry={whales.refresh} />
          : whales.data && whales.data.events.length === 0 ? <Empty title="Nothing that large yet">The tracker has not seen a transfer above $1M since it started.</Empty>
          : (
            <ul className="space-y-2">
              {whales.data?.events.map((e) => (
                <li key={e.id} className="panel-inset flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-100"><span className="num font-medium">{formatCompactUsd(e.valueUsd)}</span> {e.asset} <span className="text-zinc-500">on {e.chainName}</span></span>
                  <span className="shrink-0 text-xs text-zinc-500">{timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="rose" size="sm"><Newspaper /></IconTile>Latest headlines</h2>
            <button onClick={() => onNavigate('news')} className="btn btn-ghost btn-sm text-blue-300">More news <ArrowUpRight className="h-3 w-3" weight="bold" aria-hidden /></button>
          </div>
          {news.loading && !news.data ? <Loading /> : news.error && !news.data ? <ErrorNotice message={news.error} onRetry={news.refresh} />
          : (
            <ul className="space-y-3">
              {news.data?.articles.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <a href={safeHref(a.url)} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 text-sm text-zinc-200 hover:text-white">
                    <span className="flex-1 line-clamp-2">{a.title}</span>
                    <ArrowSquareOut className="w-3.5 h-3.5 mt-0.5 text-zinc-600 group-hover:text-zinc-300 shrink-0" aria-hidden />
                  </a>
                  <p className="text-xs text-zinc-500 mt-0.5">{a.source.name} &middot; {timeAgo(a.publishedAt)}</p>
                </li>
              ))}
              {news.data && news.data.articles.length === 0 && <Empty title="No headlines yet">The news feeds are still loading.</Empty>}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="violet" size="sm"><Notebook /></IconTile>Your recent activity</h2>
          <Pill tone="zinc">Paper trades and trade book entries</Pill>
        </div>
        {activity.length === 0 ? (
          <Empty title="No activity yet">Place a paper trade in the terminal or log a trade in the Trade Book and it will show up here.</Empty>
        ) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.id} className="panel-inset flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <IconTile tone={a.side === 'buy' ? 'mint' : 'rose'} size="sm" className="h-9 w-9">
                    {a.side === 'buy' ? <ArrowDownRight weight="bold" /> : <ArrowUpRight weight="bold" />}
                  </IconTile>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{a.title} <span className="ml-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-400">{a.tag}</span></p>
                    <p className="text-zinc-500 text-xs truncate">{a.detail}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="num text-sm font-medium text-white">{formatUsd(a.value)}</p>
                  <p className="text-zinc-500 text-xs inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden />{timeAgo(a.time)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
