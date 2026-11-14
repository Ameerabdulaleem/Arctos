import { useState } from 'react';
import { ArrowSquareOut, Buildings, ChartLine, CurrencyDollar, Info, TrendUp } from '@phosphor-icons/react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Card, Empty, ErrorNotice, IconTile, Loading, PageHeader, Pill } from './ui/common';
import { usePolling } from '../hooks/usePolling';
import { stocksService } from '../services/stocksService';
import { PRE_IPO_PLATFORMS } from '../data/preIpoListings';
import { formatPct, formatUsd, pnlClass, safeHref, sparklinePath, timeAgo } from '../lib/format';

export function StocksPreIPO() {
  const [tab, setTab] = useState<'public' | string>('public');
  const quotes = usePolling((s) => stocksService.quotes(undefined, s), 60_000);
  const platform = PRE_IPO_PLATFORMS.find((p) => p.id === tab);

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      <PageHeader icon={<Buildings />} tone="mint" title="Stocks & PRE-IPO" subtitle="Live public market quotes, plus curated access to private companies" />

      <div className="border-b border-white/[0.07] mb-6" role="tablist" aria-label="Markets">
        <div className="flex gap-6 overflow-x-auto">
          {[{ id: 'public', name: 'Public markets', icon: ChartLine }, ...PRE_IPO_PLATFORMS.map((p) => ({ id: p.id, name: `${p.name} PRE-IPO`, icon: Buildings }))].map(({ id, name, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`pb-3 px-1 border-b-2 whitespace-nowrap text-sm font-medium flex items-center gap-2 transition-colors ${tab === id ? 'border-blue-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'}`}>
              <Icon className="w-4 h-4" aria-hidden /> {name}
            </button>
          ))}
        </div>
      </div>

      {tab === 'public' && (
        <section aria-label="Public market quotes">
          {quotes.error && !quotes.data && <ErrorNotice message={quotes.error} onRetry={quotes.refresh} />}
          {quotes.loading && !quotes.data && <Loading label="Fetching quotes" />}
          {quotes.data && (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {quotes.data.quotes.map((q) => (
                  <Card key={q.symbol} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-semibold text-lg">{q.symbol}</p>
                        <p className="text-zinc-500 text-xs truncate">{q.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-semibold num">{formatUsd(q.price)}</p>
                        <p className={`text-sm num ${pnlClass(q.change)}`}>{formatPct(q.changePct)}</p>
                      </div>
                    </div>
                    <svg viewBox="0 0 170 36" className="w-full h-10 mt-3" aria-hidden>
                      <path d={sparklinePath(q.sparkline)} fill="none" stroke={q.change >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-[11px] text-zinc-500 mt-1">{q.exchange} &middot; {q.updatedAt ? timeAgo(q.updatedAt * 1000) : ''}</p>
                  </Card>
                ))}
              </div>
              {quotes.data.failed.length > 0 && <p className="mt-4 text-xs text-zinc-500">No quote available right now for {quotes.data.failed.join(', ')}.</p>}
              {quotes.data.quotes.length === 0 && <Empty title="No quotes available" />}
              <p className="mt-6 text-xs text-zinc-500">Quotes are delayed by the exchange rules (often 15 minutes) and refresh every minute. Source: Yahoo Finance.</p>
            </>
          )}
        </section>
      )}

      {platform && (
        <section aria-label={`${platform.name} listings`}>
          <Card className="p-5 mb-6">
            <div className="flex items-start gap-4">
              <IconTile tone="ice" size="lg"><Info /></IconTile>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">{platform.name}</h2>
                <p className="text-zinc-400 text-sm">{platform.description}</p>
                <p className="text-amber-300/90 text-xs mt-2">Private company data has no free live feed. Valuations below are static, may be out of date and are shown for context only.</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platform.listings.map((s) => {
              const href = safeHref(s.link);
              return (
                <article key={s.id} className="panel overflow-hidden hover:border-blue-500 transition-colors group flex flex-col">
                  <div className="relative h-44 overflow-hidden bg-white/[0.06]">
                    <ImageWithFallback src={s.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    {s.isHot && <div className="absolute top-3 right-3"><Pill tone="red"><TrendUp className="w-3 h-3" aria-hidden />HOT</Pill></div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-60" />
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <h3 className="text-xl font-semibold text-white">{s.name} <span className="text-sm font-normal text-zinc-500">{s.ticker}</span></h3>
                    <p className="text-zinc-400 text-sm my-3 line-clamp-3">{s.description}</p>
                    <dl className="space-y-2 mb-4 text-sm mt-auto">
                      <div className="flex justify-between"><dt className="text-zinc-500">Sector</dt><dd className="text-white font-medium">{s.sector}</dd></div>
                      {s.valuation && <div className="flex justify-between"><dt className="text-zinc-500" title={s.valuationNote}>Listed valuation</dt><dd className="text-zinc-200 font-semibold">{s.valuation}</dd></div>}
                      <div className="flex justify-between"><dt className="text-zinc-500">Min. investment</dt><dd className="text-white font-medium">{s.minInvestment}</dd></div>
                    </dl>
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer sponsored" className="btn btn-primary w-full py-2.5">
                        <CurrencyDollar className="w-4 h-4" aria-hidden /> View on {platform.name} <ArrowSquareOut className="w-4 h-4" aria-hidden />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-10 bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-zinc-400 mb-2">Important disclaimer</h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Investing in PRE-IPO companies involves substantial risk, including the loss of everything you invest, and may not be suitable for you. Past performance does not predict future results. Do your own research and speak to a licensed financial adviser before you invest. These links are referral links and Arctos may be paid if you sign up. Minimums and valuations change and are set by the platform.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
