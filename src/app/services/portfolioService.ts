import { apiGet, withLists } from './api';

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
  /** Token contract or mint. Absent for a chain's native coin. */
  address?: string;
  decimals?: number;
  /** The exact balance in the token's smallest unit. */
  rawAmount?: string;
  logo?: string;
  verified?: boolean;
}

export interface PortfolioResponse {
  address: string;
  kind: 'evm' | 'solana';
  holdings: Holding[];
  totalUsd: number;
  /** Small or unknown tokens counted but not listed. */
  hiddenTokens?: number;
  /** Some balances could not be read, so the total may be low. */
  partial?: boolean;
  /** Every token was looked for. False means native coins and major tokens only. */
  complete?: boolean;
  updatedAt: string;
}

export interface Nft {
  chain: string;
  chainName: string;
  contract: string;
  tokenId?: string;
  name: string;
  collection?: string;
  image?: string;
  standard: string;
}

export interface NftsResponse {
  address: string;
  nfts: Nft[];
  /** False when NFTs on these chains cannot be listed yet. */
  available: boolean;
  updatedAt: string;
}

export const portfolioService = {
  get: (address: string, signal?: AbortSignal) => apiGet<PortfolioResponse>(`/api/portfolio/${encodeURIComponent(address)}`, { signal, check: withLists('holdings') }),
  nfts: (address: string, signal?: AbortSignal) =>
    apiGet<NftsResponse>(`/api/portfolio/${encodeURIComponent(address)}/nfts`, { signal, timeoutMs: 25_000, check: withLists('nfts') }),
};
