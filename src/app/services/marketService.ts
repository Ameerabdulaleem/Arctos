import { apiGet } from './api';

export interface GlobalStats {
  totalMarketCapUsd: number;
  marketCapChange24hPct: number;
  totalVolume24hUsd: number;
  btcDominance: number;
  ethDominance: number;
  dominance: Record<string, number>;
  activeCryptocurrencies: number;
}

export interface FearGreed {
  value: number;
  label: string;
  history: Array<{ t: number; value: number }>;
}

export interface Altseason {
  index: number;
  outperformers: number;
  total: number;
  window: string;
  basis: string;
}

export interface MarketOverview {
  global: GlobalStats | null;
  fearGreed: FearGreed | null;
  altseason: Altseason | null;
  marketCapTrend: number[];
  updatedAt: string | null;
}

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number;
  marketCap: number;
  marketCapRank: number | null;
  volume24h: number;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  high24h: number | null;
  low24h: number | null;
  sparkline7d: number[];
}

export interface Ticker {
  symbol: string;
  base: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
  volumeBase: number;
  volumeQuote: number;
  updatedAt: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Depth {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface TradePrint {
  id: number;
  price: number;
  qty: number;
  time: number;
  side: 'buy' | 'sell';
}

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const marketService = {
  overview: (signal?: AbortSignal) => apiGet<MarketOverview>('/api/market/overview', { signal }),
  coins: (limit = 100, signal?: AbortSignal) =>
    apiGet<{ coins: Coin[]; updatedAt: string | null }>(`/api/market/coins?limit=${limit}`, { signal }),
  tickers: (signal?: AbortSignal) => apiGet<{ tickers: Ticker[]; source: string }>('/api/market/tickers', { signal }),
  klines: (symbol: string, interval: ChartInterval, limit = 300, signal?: AbortSignal) =>
    apiGet<Candle[]>(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`, { signal }),
  depth: (symbol: string, limit = 20, signal?: AbortSignal) =>
    apiGet<Depth>(`/api/market/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`, { signal }),
  trades: (symbol: string, limit = 30, signal?: AbortSignal) =>
    apiGet<TradePrint[]>(`/api/market/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`, { signal }),
};

/** Walks the book to find the average fill price for a market order of `qty` base units. */
export function walkBook(levels: Array<[number, number]>, qty: number): { avgPrice: number; filledQty: number } {
  let remaining = qty;
  let cost = 0;
  let filled = 0;
  for (const [price, size] of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, size);
    cost += take * price;
    filled += take;
    remaining -= take;
  }
  return { avgPrice: filled > 0 ? cost / filled : 0, filledQty: filled };
}
