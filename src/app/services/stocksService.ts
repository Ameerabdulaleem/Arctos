import { apiGet } from './api';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  currency: string;
  exchange: string;
  updatedAt: number;
  sparkline: number[];
}

export const stocksService = {
  quotes: (symbols?: string[], signal?: AbortSignal) =>
    apiGet<{ quotes: StockQuote[]; failed: string[] }>(
      `/api/stocks${symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(','))}` : ''}`,
      { signal },
    ),
};
