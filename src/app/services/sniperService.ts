import { apiGet } from './api';

export type SniperChain = 'solana' | 'ethereum' | 'bsc' | 'base' | 'arbitrum';

export const SNIPER_CHAINS: Array<{ value: SniperChain; label: string }> = [
  { value: 'solana', label: 'Solana' },
  { value: 'bsc', label: 'BNB Chain' },
  { value: 'base', label: 'Base' },
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'arbitrum', label: 'Arbitrum' },
];

export interface SniperToken {
  id: string;
  symbol: string;
  name: string;
  address: string;
  chain: SniperChain;
  pairAddress: string;
  dex: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  buys24h: number;
  sells24h: number;
  createdAt: number | null;
  url: string;
  imageUrl: string | null;
}

export interface Security {
  available: boolean;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  flags: string[];
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  holders: number | null;
  isHoneypot: boolean | null;
  source: string;
}

export interface SniperFilters {
  minLiquidityUsd: number;
  maxRiskScore: number;
  maxTaxPct: number;
  maxPositionUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
}

export const DEFAULT_FILTERS: SniperFilters = {
  minLiquidityUsd: 25_000,
  maxRiskScore: 30,
  maxTaxPct: 10,
  maxPositionUsd: 250,
  takeProfitPct: 100,
  stopLossPct: 30,
};

export const sniperService = {
  newPairs: (chain: SniperChain, signal?: AbortSignal) =>
    apiGet<{ chain: string; tokens: SniperToken[]; updatedAt: string | null }>(`/api/sniper/new?chain=${chain}`, { signal }),
  search: (q: string, chain?: SniperChain, signal?: AbortSignal) =>
    apiGet<SniperToken[]>(`/api/sniper/search?q=${encodeURIComponent(q)}${chain ? `&chain=${chain}` : ''}`, { signal }),
  refresh: (ids: string[], signal?: AbortSignal) =>
    ids.length === 0 ? Promise.resolve([] as SniperToken[]) : apiGet<SniperToken[]>(`/api/sniper/tokens?ids=${encodeURIComponent(ids.join(','))}`, { signal }),
  security: (chain: SniperChain, address: string, signal?: AbortSignal) =>
    apiGet<Security>(`/api/sniper/security?chain=${chain}&address=${encodeURIComponent(address)}`, { signal }),
};

/** Whether a token passes the user's filters. A missing risk report never counts as safe. */
export function passesFilters(token: SniperToken, security: Security | undefined, f: SniperFilters): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (token.liquidityUsd < f.minLiquidityUsd) reasons.push('Liquidity is below your minimum');
  if (!security) reasons.push('Risk check is still loading');
  else if (!security.available) reasons.push('No contract risk data available');
  else {
    if (security.isHoneypot) reasons.push('Flagged as a honeypot');
    if (security.riskScore > f.maxRiskScore) reasons.push(`Risk score ${security.riskScore} is above your limit`);
    if ((security.buyTaxPct ?? 0) > f.maxTaxPct) reasons.push('Buy tax is above your limit');
    if ((security.sellTaxPct ?? 0) > f.maxTaxPct) reasons.push('Sell tax is above your limit');
  }
  return { ok: reasons.length === 0, reasons };
}

export function chainLabel(chain: string): string {
  return SNIPER_CHAINS.find((c) => c.value === chain)?.label ?? chain;
}
