import { useMemo, useState } from 'react';
import { Clock, ExternalLink, Flame, Newspaper, RefreshCw, Search } from 'lucide-react';
import { Card, Empty, ErrorNotice, Loading, PageHeader, Pill } from './ui/common';
import { usePolling } from '../hooks/usePolling';
import { newsService, type NewsArticle, type NewsImpact } from '../services/newsService';
import { safeHref, timeAgo } from '../lib/format';

type Tab = 'total' | 'trending' | NewsImpact;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'total', label: 'All articles' }, { key: 'trending', label: 'Trending now' },
  { key: 'high', label: 'High impact' }, { key: 'medium', label: 'Medium impact' }, { key: 'low', label: 'Low impact' },
];

const impactClass = (i: NewsImpact) =>
  i === 'high' ? 'bg-red-500/10 text-red-300 border-red-500/30' : i === 'medium' ? 'bg-amber-500/10 text-amber-200 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30';

const matches = (a: NewsArticle, tab: Tab) => tab === 'total' || (tab === 'trending' ? a.trending : a.impact === tab);

export function FundamentalNews() {
  const news = usePolling((s) => newsService.list(150, s), 120_000);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('total');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');

  const articles = useMemo(() => news.data?.articles ?? [], [news.data]);
  const categories = useMemo(() => ['all', ...[...new Set(articles.map((a) => a.category))].sort()], [articles]);
  const sources = useMemo(() => ['all', ...[...new Set(articles.map((a) => a.source.name))].sort()], [articles]);
  const counts = useMemo(() => ({
    total: articles.length, trending: articles.filter((a) => a.trending).length,
    high: articles.filter((a) => a.impact === 'high').length, medium: articles.filter((a) => a.impact === 'medium').length, low: articles.filter((a) => a.impact === 'low').length,
  }), [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => matches(a, tab) && (category === 'all' || a.category === category) && (source === 'all' || a.source.name === source)
      && (!q || a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)));
  }, [articles, tab, category, source, query]);

  const trending = filtered.filter((a) => a.trending).slice(0, 4);
  const feeds = news.data?.feeds ?? [];
  const healthy = feeds.filter((f) => f.ok).length;
  const select = 'h-10 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60';

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={<Newspaper className="w-5 h-5 text-cyan-400" />} title="Fundamental News"
        subtitle="Headlines from major crypto outlets with an impact score"
        actions={
          <>
            {feeds.length > 0 && <Pill tone={healthy === feeds.length ? 'green' : healthy > 0 ? 'amber' : 'red'}>{healthy} of {feeds.length} sources responding</Pill>}
            {news.updatedAt && <span className="text-xs text-zinc-500">Updated {timeAgo(news.updatedAt)}</span>}
            <button onClick={news.refresh} disabled={news.loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white text-sm font-medium">
              <RefreshCw className={`w-4 h-4 ${news.loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
            </button>
          </>
        }
      />

      {news.error && <ErrorNotice message={news.error} onRetry={news.refresh} />}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" role="tablist" aria-label="Filter by impact">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-xl border p-4 text-left transition-colors ${tab === t.key ? 'border-cyan-500 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t.label}</p>
            <p className="text-xl font-bold mt-1 tabular-nums text-white">{counts[t.key]}</p>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <label className="relative block">
            <span className="sr-only">Search news</span>
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, category or summary" className={`${select} w-full pl-9 pr-3 placeholder:text-zinc-500`} />
          </label>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={select}>{categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}</select>
          <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={select}>{sources.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>)}</select>
          <button onClick={() => { setQuery(''); setCategory('all'); setSource('all'); setTab('total'); }} className="h-10 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700">Clear filters</button>
        </div>
      </Card>

      {trending.length > 0 && (
        <section className="space-y-3" aria-label="Trending">
          <h2 className="text-lg font-bold flex items-center gap-2 text-white"><Flame className="w-5 h-5 text-orange-500" aria-hidden /> Trending now</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {trending.map((a) => (
              <a key={a.id} href={safeHref(a.url)} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-900 to-zinc-800 p-5 hover:border-cyan-500 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-2 min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.source.color }} /><span className="text-sm text-zinc-300 truncate">{a.source.name}</span></span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold uppercase border ${impactClass(a.impact)}`}>{a.impact}</span>
                </div>
                <h3 className="text-lg font-semibold leading-snug mb-2 text-white">{a.title}</h3>
                <p className="text-sm text-zinc-400 mb-4 line-clamp-2">{a.excerpt || 'No summary available.'}</p>
                <div className="flex items-center justify-between text-xs text-zinc-400"><span className="px-2 py-1 rounded-md border border-zinc-700 bg-zinc-800">{a.category}</span><span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden />{timeAgo(a.publishedAt)}</span></div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-label="All news">
        <h2 className="text-lg font-bold text-white">All news</h2>
        {news.loading && !news.data ? <Card className="p-10"><Loading label="Fetching the latest headlines" /></Card>
        : filtered.length === 0 ? <Card><Empty title={articles.length === 0 ? 'No headlines loaded yet' : 'No matching news'}>{articles.length === 0 ? 'The data service is still reading the news feeds.' : 'Try clearing the filters or widening your search.'}</Empty></Card>
        : (
          <div className="space-y-3">
            {filtered.map((a) => (
              <a key={a.id} href={safeHref(a.url)} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-cyan-500 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.source.color }} />
                      <span className="text-sm text-zinc-400">{a.source.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${impactClass(a.impact)}`}>{a.impact}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs border border-zinc-700 bg-zinc-800 text-zinc-300">{a.category}</span>
                      {a.trending && <Flame className="w-4 h-4 text-orange-500" aria-label="Trending" />}
                    </div>
                    <h3 className="font-semibold text-white leading-snug">{a.title}</h3>
                    <p className="text-sm text-zinc-400 mt-1 line-clamp-2">{a.excerpt || 'No summary available.'}</p>
                    <p className="mt-2 text-xs text-zinc-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden />{timeAgo(a.publishedAt)}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-zinc-500 shrink-0 mt-1" aria-hidden />
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-zinc-500">Impact and category are estimated from the wording of each headline and are not investment advice. Articles open on the publisher's site.</p>
    </div>
  );
}
