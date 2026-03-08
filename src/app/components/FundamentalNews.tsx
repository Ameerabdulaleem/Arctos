import { useEffect, useMemo, useState } from 'react';
import { Newspaper, ExternalLink, Clock, Search, RefreshCw, Flame } from 'lucide-react';
import { NewsArticle, newsService } from '../services/newsService';

type NewsTab = 'total' | 'trending' | 'high' | 'medium' | 'low';

const TAB_CONFIG: Array<{ key: NewsTab; label: string }> = [
  { key: 'total', label: 'Total Articles' },
  { key: 'trending', label: 'Trending Now' },
  { key: 'high', label: 'High Impact' },
  { key: 'medium', label: 'Medium Impact' },
  { key: 'low', label: 'Low Impact' },
];

const getTimeAgo = (date: Date) => {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const getImpactClass = (impact: string) => {
  if (impact === 'high') return 'bg-red-500/10 text-red-300 border border-red-500/30';
  if (impact === 'medium') return 'bg-amber-500/10 text-amber-200 border border-amber-500/30';
  return 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30';
};

const matchesTab = (article: NewsArticle, tab: NewsTab): boolean => {
  if (tab === 'total') return true;
  if (tab === 'trending') return article.trending;
  if (tab === 'high') return article.impact === 'high';
  if (tab === 'medium') return article.impact === 'medium';
  return article.impact === 'low';
};

export function FundamentalNews() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState<NewsTab>('total');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [provider, setProvider] = useState('mock');
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const categories = useMemo(() => {
    return ['all', ...Array.from(new Set(news.map((article) => article.category))).sort()];
  }, [news]);

  const sources = useMemo(() => {
    return ['all', ...Array.from(new Set(news.map((article) => article.source.name))).sort()];
  }, [news]);

  const tabCounts = useMemo(() => {
    return {
      total: news.length,
      trending: news.filter((item) => item.trending).length,
      high: news.filter((item) => item.impact === 'high').length,
      medium: news.filter((item) => item.impact === 'medium').length,
      low: news.filter((item) => item.impact === 'low').length,
    };
  }, [news]);

  const filteredNews = useMemo(() => {
    return news
      .filter((article) => matchesTab(article, selectedTab))
      .filter((article) => selectedCategory === 'all' || article.category === selectedCategory)
      .filter((article) => selectedSource === 'all' || article.source.name === selectedSource)
      .filter((article) => {
        if (!searchQuery.trim()) {
          return true;
        }

        const query = searchQuery.toLowerCase();
        return (
          article.title.toLowerCase().includes(query) ||
          article.excerpt.toLowerCase().includes(query) ||
          article.category.toLowerCase().includes(query)
        );
      });
  }, [news, selectedTab, selectedCategory, selectedSource, searchQuery]);

  const trendingNews = useMemo(() => {
    return filteredNews.filter((article) => article.trending).slice(0, 4);
  }, [filteredNews]);

  const loadNews = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }

    setIsRefreshing(true);
    try {
      const result = await newsService.getNews();
      setNews(result.articles);
      setProvider(result.provider);
      setIsLive(result.isLive);
      setLastUpdated(result.fetchedAt);
      setErrorMessage(result.error || null);
    } catch {
      setErrorMessage('Failed to fetch news. Please verify your API settings and try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadNews();

    const refreshInterval = newsService.getRefreshIntervalMs();
    const interval = window.setInterval(() => {
      void loadNews(true);
    }, refreshInterval);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-full bg-black text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Newspaper className="w-8 h-8 text-cyan-400" />
              Fundamental News
            </h1>
            <p className="text-zinc-400 mt-1">Live crypto and macro headlines with impact scoring and smart filtering.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full border ${isLive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
                {isLive ? 'Live Data' : 'Mock Data'}
              </span>
              <span className="px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                Provider: {provider}
              </span>
              {lastUpdated && (
                <span className="px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                  Updated {getTimeAgo(lastUpdated)}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => void loadNews(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </section>

        {errorMessage && (
          <div className="rounded-lg border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {errorMessage}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {TAB_CONFIG.map((tab) => {
            const count = tab.key === 'total'
              ? tabCounts.total
              : tab.key === 'trending'
                ? tabCounts.trending
                : tab.key === 'high'
                  ? tabCounts.high
                  : tab.key === 'medium'
                    ? tabCounts.medium
                    : tabCounts.low;

            return (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key)}
                className={`rounded-xl border p-4 text-left transition-all ${selectedTab === tab.key ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}
              >
                <p className="text-xs uppercase tracking-wide text-zinc-400">{tab.label}</p>
                <p className="text-2xl font-semibold mt-1">{count}</p>
              </button>
            );
          })}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <label className="relative block">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search title, category, or summary"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              />
            </label>

            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              {categories.map((category) => (
                <option key={category} value={category} className="bg-zinc-900">
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>

            <select
              value={selectedSource}
              onChange={(event) => setSelectedSource(event.target.value)}
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              {sources.map((source) => (
                <option key={source} value={source} className="bg-zinc-900">
                  {source === 'all' ? 'All Sources' : source}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setSelectedSource('all');
                setSelectedTab('total');
              }}
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </section>

        {!isLoading && trendingNews.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              Trending Now
            </h2>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {trendingNews.map((article) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-900 to-zinc-800 p-5 hover:border-cyan-500 transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="inline-flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: article.source.color }} />
                      <span className="text-sm text-zinc-300 truncate">{article.source.name}</span>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold uppercase ${getImpactClass(article.impact)}`}>
                      {article.impact}
                    </span>
                  </div>

                  <h3 className="text-lg font-semibold leading-snug mb-2">{article.title}</h3>
                  <p className="text-sm text-zinc-400 mb-4 line-clamp-2">{article.excerpt || 'No excerpt available.'}</p>

                  <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
                    <span className="px-2 py-1 rounded-md border border-zinc-700 bg-zinc-800">{article.category}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getTimeAgo(article.publishedAt)}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-xl font-bold">All News</h2>

          {isLoading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-400">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-3" />
              Fetching latest headlines...
            </div>
          ) : filteredNews.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center">
              <Newspaper className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-300 font-medium">No matching news found</p>
              <p className="text-zinc-500 text-sm mt-1">Try clearing filters or widening your search query.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredNews.map((article) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-cyan-500 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: article.source.color }} />
                        <span className="text-sm text-zinc-400">{article.source.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getImpactClass(article.impact)}`}>
                          {article.impact}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs border border-zinc-700 bg-zinc-800 text-zinc-300">
                          {article.category}
                        </span>
                        {article.trending && <Flame className="w-4 h-4 text-orange-500" />}
                      </div>

                      <h3 className="font-semibold text-white leading-snug">{article.title}</h3>
                      <p className="text-sm text-zinc-400 mt-1 line-clamp-2">{article.excerpt || 'No excerpt available.'}</p>

                      <div className="mt-2 text-xs text-zinc-500 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {getTimeAgo(article.publishedAt)}
                      </div>
                    </div>

                    <ExternalLink className="w-4 h-4 text-zinc-500 shrink-0 mt-1" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300 mb-1">Live API setup</p>
          <p>
            Configure <code className="text-zinc-200">VITE_NEWS_PROVIDER</code> and <code className="text-zinc-200">VITE_NEWS_API_KEY</code> in your <code className="text-zinc-200">.env</code>. Supported providers: <code className="text-zinc-200">gnews</code>, <code className="text-zinc-200">newsapi</code>, <code className="text-zinc-200">cryptopanic</code>, <code className="text-zinc-200">custom</code>, or <code className="text-zinc-200">auto</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
