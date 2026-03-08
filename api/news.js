const DEFAULT_QUERY = 'crypto OR bitcoin OR ethereum OR solana OR base';
const DEFAULT_MAX = 40;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}

function normalizeMax(rawValue) {
  const parsed = Number(rawValue || DEFAULT_MAX);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX;
  }

  return Math.max(1, Math.min(parsed, 100));
}

function inferCategory(text) {
  const value = (text || '').toLowerCase();
  if (value.includes('bitcoin') || value.includes('btc')) return 'Bitcoin';
  if (value.includes('ethereum') || value.includes('eth') || value.includes('layer-2') || value.includes('l2')) return 'Ethereum';
  if (value.includes('solana') || value.includes('sol')) return 'Solana';
  if (value.includes('regulation') || value.includes('sec') || value.includes('etf') || value.includes('policy')) return 'Regulation';
  if (value.includes('defi') || value.includes('yield') || value.includes('liquidity') || value.includes('swap')) return 'DeFi';
  if (value.includes('stablecoin') || value.includes('usdt') || value.includes('usdc')) return 'Stablecoins';
  if (value.includes('nft')) return 'NFT';
  if (value.includes('whale') || value.includes('on-chain') || value.includes('onchain')) return 'On-Chain';
  if (value.includes('exchange') || value.includes('binance') || value.includes('coinbase') || value.includes('kraken')) return 'Exchange';
  if (value.includes('macro') || value.includes('fed') || value.includes('inflation') || value.includes('rates')) return 'Macro';
  return 'Market';
}

function inferImpact(text) {
  const value = (text || '').toLowerCase();
  const highSignals = ['breaking', 'etf', 'sec', 'ban', 'hack', 'exploit', 'lawsuit', 'approval', 'rate cut', 'record inflow'];
  const mediumSignals = ['launch', 'integration', 'partnership', 'upgrade', 'growth', 'surge', 'milestone'];

  if (highSignals.some((signal) => value.includes(signal))) {
    return 'high';
  }

  if (mediumSignals.some((signal) => value.includes(signal))) {
    return 'medium';
  }

  return 'low';
}

function inferTrending(publishedAt, impact, text) {
  const publishedAtMs = new Date(publishedAt).getTime();
  const ageMs = Number.isNaN(publishedAtMs) ? Number.MAX_SAFE_INTEGER : Date.now() - publishedAtMs;
  const value = (text || '').toLowerCase();
  const hotWords = ['breaking', 'surge', 'record', 'all-time high', 'urgent'];

  if (ageMs <= 1000 * 60 * 60 * 4 && impact !== 'low') {
    return true;
  }

  return hotWords.some((word) => value.includes(word));
}

function normalize(items) {
  return items
    .map((item, index) => {
      const title = (item.title || '').trim();
      if (!title) {
        return null;
      }

      const excerpt = (item.excerpt || item.description || '').trim();
      const category = item.category || inferCategory(`${title} ${excerpt}`);
      const impact = ['high', 'medium', 'low'].includes((item.impact || '').toLowerCase())
        ? item.impact.toLowerCase()
        : inferImpact(`${title} ${excerpt}`);
      const publishedAt = item.publishedAt || item.published_at || new Date().toISOString();

      return {
        id: item.id || item.url || `${item.sourceName || item.source || 'source'}-${index}-${publishedAt}`,
        title,
        excerpt,
        source: {
          name: item.sourceName || item.source || 'Unknown',
          url: item.sourceUrl || item.url || '#',
        },
        category,
        impact,
        publishedAt,
        imageUrl: item.imageUrl,
        url: item.url || '#',
        trending: typeof item.trending === 'boolean'
          ? item.trending
          : inferTrending(publishedAt, impact, `${title} ${excerpt}`),
      };
    })
    .filter(Boolean);
}

async function fetchFromGNews({ apiKey, query, max }) {
  const params = new URLSearchParams({
    q: query,
    lang: 'en',
    max: String(max),
    sortby: 'publishedAt',
    apikey: apiKey,
  });

  const response = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`GNews failed with status ${response.status}`);
  }

  const data = await response.json();
  return normalize((data.articles || []).map((article) => ({
    id: article.url,
    title: article.title,
    description: article.description,
    sourceName: article.source?.name,
    sourceUrl: article.source?.url,
    publishedAt: article.publishedAt,
    imageUrl: article.image,
    url: article.url,
  })));
}

async function fetchFromNewsApi({ apiKey, query, max }) {
  const params = new URLSearchParams({
    q: query,
    language: 'en',
    sortBy: 'publishedAt',
    pageSize: String(max),
  });

  const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`NewsAPI failed with status ${response.status}`);
  }

  const data = await response.json();
  return normalize((data.articles || []).map((article) => ({
    id: article.url,
    title: article.title,
    description: article.description,
    sourceName: article.source?.name,
    sourceUrl: article.url,
    publishedAt: article.publishedAt,
    imageUrl: article.urlToImage,
    url: article.url,
  })));
}

async function fetchFromCryptoPanic({ apiKey, max }) {
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
    throw new Error(`CryptoPanic failed with status ${response.status}`);
  }

  const data = await response.json();
  return normalize((data.results || []).slice(0, max).map((article) => ({
    id: article.id ? String(article.id) : article.url,
    title: article.title,
    sourceName: article.source?.title || article.domain || 'Crypto Panic',
    sourceUrl: article.source?.domain || article.url,
    publishedAt: article.published_at,
    url: article.url,
  })));
}

function resolveProvider(inputProvider) {
  const provider = (inputProvider || process.env.NEWS_PROVIDER || 'gnews').toLowerCase();
  if (['gnews', 'newsapi', 'cryptopanic'].includes(provider)) {
    return provider;
  }

  return 'gnews';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return json(res, 204, {});
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const queryInput = req.query?.query;
  const providerInput = req.query?.provider;
  const maxInput = req.query?.max;

  const provider = resolveProvider(providerInput);
  const query = typeof queryInput === 'string' && queryInput.trim() ? queryInput.trim() : (process.env.NEWS_API_QUERY || DEFAULT_QUERY);
  const max = normalizeMax(maxInput || process.env.NEWS_MAX_ARTICLES);
  const apiKey = process.env.NEWS_API_KEY || process.env.NEWS_GNEWS_API_KEY || process.env.NEWSAPI_KEY || process.env.CRYPTOPANIC_API_KEY;

  try {
    let articles = [];

    if (provider === 'gnews') {
      const key = process.env.NEWS_GNEWS_API_KEY || process.env.NEWS_API_KEY || apiKey;
      if (!key) {
        return json(res, 500, { error: 'Missing server NEWS_GNEWS_API_KEY or NEWS_API_KEY.' });
      }
      articles = await fetchFromGNews({ apiKey: key, query, max });
    } else if (provider === 'newsapi') {
      const key = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY || apiKey;
      if (!key) {
        return json(res, 500, { error: 'Missing server NEWSAPI_KEY or NEWS_API_KEY.' });
      }
      articles = await fetchFromNewsApi({ apiKey: key, query, max });
    } else {
      const key = process.env.CRYPTOPANIC_API_KEY || process.env.NEWS_API_KEY || apiKey;
      articles = await fetchFromCryptoPanic({ apiKey: key, max });
    }

    return json(res, 200, {
      provider,
      fetchedAt: new Date().toISOString(),
      articles,
    });
  } catch (error) {
    return json(res, 500, {
      error: error?.message || 'Failed to fetch news from provider.',
      provider,
    });
  }
}
