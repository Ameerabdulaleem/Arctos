import { apiGet } from './api';

export interface Holding {
  chain: string;
  chainName: string;
  symbol: string;
  name: string;
  kind: 'native' | 'token';
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  change24h: number | null;
}

export interface PortfolioResponse {
  address: string;
  kind: 'evm' | 'solana';
  holdings: Holding[];
  totalUsd: number;
  updatedAt: string;
}

export const portfolioService = {
  get: (address: string, signal?: AbortSignal) => apiGet<PortfolioResponse>(`/api/portfolio/${encodeURIComponent(address)}`, { signal }),
};
