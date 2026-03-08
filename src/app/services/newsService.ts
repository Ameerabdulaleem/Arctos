export type NewsImpact = 'high' | 'medium' | 'low';

export interface NewsSource {
  name: string;
  url: string;
  color: string;
}

export interface NewsArticle {
  id: string;
  title: string;
  excerpt: string;
  source: NewsSource;
  category: string;
  impact: NewsImpact;
  publishedAt: Date;
  imageUrl?: string;
  url: string;
  trending: boolean;
}

export interface NewsFetchResult {
  articles: NewsArticle[];
  fetchedAt: Date;
  isLive: boolean;
  provider: string;
  error?: string;
}

type Provider = 'mock' | 'gnews' | 'newsapi' | 'cryptopanic' | 'custom' | 'auto';

const SOURCE_COLORS: Record<string, string> = {
  coindesk: '#FF6B00',
  'the block': '#00B4D8',
  decrypt: '#00FF85',
  cryptoslate: '#4F46E5',
  cointelegraph: '#FDB022',
  reuters: '#FA4D56',
  bloomberg: '#8A63D2',
  'crypto panic': '#7DD3FC',
  unknown: '#94A3B8',
};

const MAX_ARTICLES = Number(import.meta.env.VITE_NEWS_MAX_ARTICLES || '40');
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

const MOCK_NEWS: NewsArticle[] = [
  {
    id: 'mock-1',
    title: 'Bitcoin ETF Sees Strong Inflow as Institutional Demand Accelerates',
    excerpt: 'Spot BTC products continued to attract large inflows as market sentiment improved across risk assets.',
    source: {
      name: 'CoinDesk',
      url: 'https://www.coindesk.com',
      color: '#FF6B00',
    },
    category: 'Bitcoin',
    impact: 'high',
    publishedAt: new Date(Date.now() - 1000 * 60 * 18),
    url: 'https://www.coindesk.com',
    trending: true,
  },
  {
    id: 'mock-2',
    title: 'Ethereum Layer-2 Activity Climbs with Base and Arbitrum Leading Growth',
    excerpt: 'Layer-2 ecosystems saw steady growth in users and transaction throughput over the past 24 hours.',
    source: {
      name: 'The Block',
      url: 'https://www.theblock.co',
      color: '#00B4D8',
    },
    category: 'DeFi',
    impact: 'medium',
    publishedAt: new Date(Date.now() - 1000 * 60 * 47),
    url: 'https://www.theblock.co',
    trending: true,
  },
  {
    id: 'mock-3',
    title: 'Stablecoin Supply Hits New High as Exchange Liquidity Expands',
    excerpt: 'USDT and USDC growth contributed to a higher aggregate stablecoin market capitalization.',
    source: {
      name: 'CryptoSlate',
      url: 'https://cryptoslate.com',
      color: '#4F46E5',
    },
    category: 'Stablecoins',
    impact: 'medium',
    publishedAt: new Date(Date.now() - 1000 * 60 * 110),
    url: 'https://cryptoslate.com',
    trending: false,
  },
  {
    id: 'mock-4',
    title: 'Regulators Signal New Consultation Window for Digital Asset Framework',
    excerpt: 'Global regulators opened a consultation period on proposed oversight standards for virtual assets.',
    source: {
      name: 'Cointelegraph',
      url: 'https://cointelegraph.com',
      color: '#FDB022',
    },
    category: 'Regulation',
    impact: 'high',
    publishedAt: new Date(Date.now() - 1000 * 60 * 180),
    url: 'https://cointelegraph.com',
    trending: false,
  },
  {
    id: 'mock-5',
    title: 'Major Exchange Adds New SOL Trading Pairs for Emerging Markets',
    excerpt: 'The exchange plans to roll out additional spot pairs and improve regional fiat rails.',
    source: {
      name: 'Decrypt',
      url: 'https://decrypt.co',
      color: '#00FF85',
    },
    category: 'Exchange',
    impact: 'low',
    publishedAt: new Date(Date.now() - 1000 * 60 * 290),
    url: 'https://decrypt.co',
    trending: false,
  },
];

const getProvider = (): Provider => {
  const raw = (import.meta.env.VITE_NEWS_PROVIDER as string | undefined)?.toLowerCase();
  if (!raw) {
    return 'custom';
  }

  if (['mock', 'gnews', 'newsapi', 'cryptopanic', 'custom', 'auto'].includes(raw)) {
    return raw as Provider;
  }

  return 'auto';
};

const getQuery = (): string => {
  return (import.meta.env.VITE_NEWS_API_QUERY as string | undefined) || 'crypto OR bitcoin OR ethereum OR solana OR base';
};

const getColorForSource = (name: string): string => {
  const normalized = name.toLowerCase();
  return SOURCE_COLORS[normalized] || SOURCE_COLORS.unknown;
};

const inferCategory = (text: string): string => {
  const v = text.toLowerCase();
  if (v.includes('bitcoin') || v.includes('btc')) return 'Bitcoin';
  if (v.includes('ethereum') || v.includes('eth') || v.includes('layer-2') || v.includes('l2')) return 'Ethereum';
  if (v.includes('solana') || v.includes('sol')) return 'Solana';
  if (v.includes('regulation') || v.includes('sec') || v.includes('etf') || v.includes('policy')) return 'Regulation';
  if (v.includes('defi') || v.includes('yield') || v.includes('liquidity') || v.includes('swap')) return 'DeFi';
  if (v.includes('stablecoin') || v.includes('usdt') || v.includes('usdc')) return 'Stablecoins';
  if (v.includes('nft')) return 'NFT';
  if (v.includes('whale') || v.includes('on-chain') || v.includes('onchain')) return 'On-Chain';
  if (v.includes('exchange') || v.includes('binance') || v.includes('coinbase') || v.includes('kraken')) return 'Exchange';
  if (v.includes('macro') || v.includes('fed') || v.includes('inflation') || v.includes('rates')) return 'Macro';
  return 'Market';
};

const inferImpact = (text: string): NewsImpact => {
  const v = text.toLowerCase();
  const highSignals = ['breaking', 'etf', 'sec', 'ban', 'hack', 'exploit', 'lawsuit', 'approval', 'rate cut', 'record inflow'];
  const mediumSignals = ['launch', 'integration', 'partnership', 'upgrade', 'growth', 'surge', 'milestone'];

  if (highSignals.some((signal) => v.includes(signal))) {
    return 'high';
  }

  if (mediumSignals.some((signal) => v.includes(signal))) {
    return 'medium';
  }

  return 'low';
};

const inferTrending = (publishedAt: Date, impact: NewsImpact, text: string): boolean => {
  const ageMs = Date.now() - publishedAt.getTime();
  const recentWindowMs = 1000 * 60 * 60 * 4;
  const v = text.toLowerCase();
  const hotWords = ['breaking', 'surge', 'record', 'all-time high', 'urgent'];

  if (ageMs <= recentWindowMs && impact !== 'low') {
    return true;
  }

  return hotWords.some((word) => v.includes(word));
};

const normalizeArticle = (input: {
  id?: string;
  title?: string;
  excerpt?: string;
  description?: string;
  sourceName?: string;
  sourceUrl?: string;
  url?: string;
  imageUrl?: string;
  publishedAt?: string | number | Date;
  category?: string;
  impact?: string;
  trending?: boolean;
},
index: number): NewsArticle | null => {
  const title = (input.title || '').trim();
  if (!title) {
    return null;
  }

  const excerpt = (input.excerpt || input.description || '').trim();
  const sourceName = (input.sourceName || 'Unknown').trim();
  const sourceUrl = (input.sourceUrl || input.url || '#').trim();
  const url = (input.url || sourceUrl || '#').trim();
  const published = input.publishedAt ? new Date(input.publishedAt) : new Date();
  const parsedImpact = (input.impact || '').toLowerCase();
  const text = `${title} ${excerpt}`;
  const inferredImpact = parsedImpact === 'high' || parsedImpact === 'medium' || parsedImpact === 'low'
    ? (parsedImpact as NewsImpact)
    : inferImpact(text);

  const category = (input.category || inferCategory(text)).trim();

  return {
    id: input.id || `${sourceName}-${published.getTime()}-${index}`,
    title,
    excerpt,
    source: {
      name: sourceName,
      url: sourceUrl,
      color: getColorForSource(sourceName),
    },
    category,
    impact: inferredImpact,
    publishedAt: Number.isNaN(published.getTime()) ? new Date() : published,
    imageUrl: input.imageUrl,
    url,
    trending: typeof input.trending === 'boolean'
      ? input.trending
      : inferTrending(Number.isNaN(published.getTime()) ? new Date() : published, inferredImpact, text),
  };
};

const parseGNews = async (): Promise<NewsArticle[]> => {
  const apiKey = import.meta.env.VITE_NEWS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_NEWS_API_KEY for gnews provider.');
  }

  const params = new URLSearchParams({
    q: getQuery(),
    lang: 'en',
    max: String(MAX_ARTICLES),
    sortby: 'publishedAt',
    apikey: apiKey,
  });

  const response = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`GNews request failed with ${response.status}.`);
  }

  const data = await response.json() as {
    articles?: Array<{
      title?: string;
      description?: string;
      url?: string;
      image?: string;
      publishedAt?: string;
      source?: {
        name?: string;
        url?: string;
      };
    }>;
  };

  return (data.articles || [])
    .map((article, index) => normalizeArticle({
      id: article.url,
      title: article.title,
      description: article.description,
      sourceName: article.source?.name,
      sourceUrl: article.source?.url,
      url: article.url,
      imageUrl: article.image,
      publishedAt: article.publishedAt,
    }, index))
    .filter((article): article is NewsArticle => Boolean(article));
};

const parseNewsApi = async (): Promise<NewsArticle[]> => {
  const apiKey = import.meta.env.VITE_NEWS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_NEWS_API_KEY for newsapi provider.');
  }

  const params = new URLSearchParams({
    q: getQuery(),
    language: 'en',
    sortBy: 'publishedAt',
    pageSize: String(MAX_ARTICLES),
  });

  const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`NewsAPI request failed with ${response.status}.`);
  }

  const data = await response.json() as {
    articles?: Array<{
      title?: string;
      description?: string;
      url?: string;
      urlToImage?: string;
      publishedAt?: string;
      source?: {
        name?: string;
      };
    }>;
  };

  return (data.articles || [])
    .map((article, index) => normalizeArticle({
      id: article.url,
      title: article.title,
      description: article.description,
      sourceName: article.source?.name,
      sourceUrl: article.url,
      url: article.url,
      imageUrl: article.urlToImage,
      publishedAt: article.publishedAt,
    }, index))
    .filter((article): article is NewsArticle => Boolean(article));
};

const parseCryptoPanic = async (): Promise<NewsArticle[]> => {
  const apiKey = import.meta.env.VITE_NEWS_API_KEY as string | undefined;
  const params = new URLSearchParams({
    kind: 'news',
    public: 'true',
    currencies: 'BTC,ETH,SOL,BNB',
  });

  if (apiKey) {
    params.set('auth_token', apiKey);
  }

  const response = await fetch(`https://cryptopanic.com/api/v1/posts/?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`CryptoPanic request failed with ${response.status}.`);
  }

  const data = await response.json() as {
    results?: Array<{
      id?: number;
      title?: string;
      published_at?: string;
      url?: string;
      domain?: string;
      source?: {
        title?: string;
        domain?: string;
      };
    }>;
  };

  return (data.results || [])
    .slice(0, MAX_ARTICLES)
    .map((article, index) => normalizeArticle({
      id: article.id ? String(article.id) : article.url,
      title: article.title,
      description: '',
      sourceName: article.source?.title || article.domain || 'Crypto Panic',
      sourceUrl: article.source?.domain || article.url,
      url: article.url,
      publishedAt: article.published_at,
    }, index))
    .filter((article): article is NewsArticle => Boolean(article));
};

const parseCustom = async (): Promise<NewsArticle[]> => {
  const endpoint = (import.meta.env.VITE_NEWS_API_URL as string | undefined) || `${API_BASE}/api/news`;
  if (!endpoint) {
    throw new Error('Missing VITE_NEWS_API_URL for custom provider.');
  }

  const apiKey = import.meta.env.VITE_NEWS_API_KEY as string | undefined;
  const apiKeyHeader = (import.meta.env.VITE_NEWS_API_KEY_HEADER as string | undefined) || 'x-api-key';

  const response = await fetch(endpoint, {
    headers: apiKey ? { [apiKeyHeader]: apiKey } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Custom news API request failed with ${response.status}.`);
  }

  const payload = await response.json() as {
    articles?: unknown[];
    news?: unknown[];
    results?: unknown[];
  } | unknown[];

  const list = Array.isArray(payload)
    ? payload
    : payload.articles || payload.news || payload.results || [];

  return list
    .slice(0, MAX_ARTICLES)
    .map((item, index) => {
      const article = item as {
        id?: string;
        title?: string;
        excerpt?: string;
        description?: string;
        summary?: string;
        source?: {
          name?: string;
          url?: string;
        };
        sourceName?: string;
        sourceUrl?: string;
        category?: string;
        impact?: string;
        publishedAt?: string;
        published_at?: string;
        imageUrl?: string;
        image?: string;
        url?: string;
        link?: string;
        trending?: boolean;
      };

      return normalizeArticle({
        id: article.id || article.url || article.link,
        title: article.title,
        excerpt: article.excerpt || article.summary,
        description: article.description,
        sourceName: article.source?.name || article.sourceName,
        sourceUrl: article.source?.url || article.sourceUrl,
        category: article.category,
        impact: article.impact,
        publishedAt: article.publishedAt || article.published_at,
        imageUrl: article.imageUrl || article.image,
        url: article.url || article.link,
        trending: article.trending,
      }, index);
    })
    .filter((article): article is NewsArticle => Boolean(article));
};

const parseByProvider = async (provider: Provider): Promise<NewsArticle[]> => {
  switch (provider) {
    case 'gnews':
      return parseGNews();
    case 'newsapi':
      return parseNewsApi();
    case 'cryptopanic':
      return parseCryptoPanic();
    case 'custom':
      return parseCustom();
    default:
      return MOCK_NEWS;
  }
};

const sortNews = (items: NewsArticle[]): NewsArticle[] => {
  return [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
};

export const newsService = {
  getRefreshIntervalMs(): number {
    const intervalRaw = Number(import.meta.env.VITE_NEWS_REFRESH_INTERVAL_MS || '120000');
    if (Number.isNaN(intervalRaw)) {
      return 120000;
    }

    return Math.max(15000, intervalRaw);
  },

  async getNews(): Promise<NewsFetchResult> {
    const configuredProvider = getProvider();
    const providersToTry: Provider[] = configuredProvider === 'auto'
      ? ['custom', 'gnews', 'newsapi', 'cryptopanic']
      : [configuredProvider];

    for (const provider of providersToTry) {
      try {
        const articles = sortNews(await parseByProvider(provider));
        if (articles.length > 0) {
          return {
            articles,
            fetchedAt: new Date(),
            isLive: provider !== 'mock',
            provider,
          };
        }
      } catch {
        // Continue trying other providers in auto mode.
      }
    }

    return {
      articles: sortNews(MOCK_NEWS),
      fetchedAt: new Date(),
      isLive: false,
      provider: 'mock',
      error: 'Live providers unavailable. Showing mock data.',
    };
  },
};
