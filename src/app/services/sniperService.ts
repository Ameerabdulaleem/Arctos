import { apiGet } from './api';

/** A chain key such as "solana" or "bsc". The full list comes from the data service. */
export type SniperChain = string;

export interface Launchpad {
  id: string;
  name: string;
}

export interface ChainOption {
  key: SniperChain;
  name: string;
  /** True when contract risk checks are available on this chain. */
  riskChecks: boolean;
  launchpads: Launchpad[];
}

/** Shown until the data service answers with the full list. */
export const FALLBACK_CHAINS: ChainOption[] = [
  { key: 'solana', name: 'Solana', riskChecks: true, launchpads: [] },
  { key: 'bsc', name: 'BNB Chain', riskChecks: true, launchpads: [] },
  { key: 'base', name: 'Base', riskChecks: true, launchpads: [] },
  { key: 'avalanche', name: 'Avalanche', riskChecks: true, launchpads: [] },
  { key: 'near', name: 'NEAR', riskChecks: false, launchpads: [] },
  { key: 'robinhood', name: 'Robinhood Chain', riskChecks: false, launchpads: [] },
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

export interface Flow {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

export interface DevRecord {
  /** Earlier launches by this wallet that the service has observed. */
  launchesSeen: number;
  successes: number;
  /** 0 to 100, or null until at least two earlier launches are known. */
  successRate: number | null;
  avgBuyRatio: number | null;
}

export interface Developer {
  address: string;
  holdingPct: number | null;
  record: DevRecord;
  verdict: 'proven' | 'mixed' | 'poor' | 'first';
}

export interface SnipeScore {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  parts: { demand: number; developer: number; safety: number; liquidity: number; momentum: number };
  reasons: string[];
  warnings: string[];
  /** A serious risk was found. Never buy. */
  blocked: boolean;
  /** False until the developer, holders and contract have been checked. */
  checked: boolean;
}

/** A token from the launchpad feed, with its score and everything the score is based on. */
export interface FeedToken extends SniperToken {
  launchpad: string | null;
  /** True while the token still trades against a bonding curve, which has no ordinary pool. */
  onCurve: boolean;
  graduation: { percent: number; completed: boolean } | null;
  flow1h: Flow;
  flow24h: Flow;
  buyRatioPct: number | null;
  holders: number | null;
  top10Pct: number | null;
  developer: Developer | null;
  security: Security | null;
  score: SnipeScore;
}

export type FeedView = 'new' | 'active';

export interface FeedResponse {
  chain: string;
  launchpad: string;
  view: FeedView;
  tokens: FeedToken[];
  checked: number;
  developersKnown: number;
  updatedAt: string;
}

export interface SniperFilters {
  /** Lowest snipe score (0 to 100) the auto sniper will buy. */
  minScore: number;
  /** Lowest share of recent trades that must be buys, in percent. */
  minBuyRatioPct: number;
  /** Lowest developer success rate in percent. 0 also accepts developers with no record yet. */
  minDevSuccessPct: number;
  /** Highest share of supply the developer may still hold, in percent. */
  maxDevHoldingPct: number;
  minLiquidityUsd: number;
  maxRiskScore: number;
  maxTaxPct: number;
  maxPositionUsd: number;
}

/** Strict by default: only well rated, fully checked tokens with buyers in control. */
export const DEFAULT_FILTERS: SniperFilters = {
  minScore: 75,
  minBuyRatioPct: 58,
  minDevSuccessPct: 0,
  maxDevHoldingPct: 12,
  minLiquidityUsd: 15_000,
  maxRiskScore: 25,
  maxTaxPct: 8,
  maxPositionUsd: 250,
};

export const sniperService = {
  chains: (signal?: AbortSignal) => apiGet<ChainOption[]>('/api/sniper/chains', { signal }),
  feed: (chain: SniperChain, launchpad: string, view: FeedView, signal?: AbortSignal) =>
    apiGet<FeedResponse>(`/api/sniper/feed?chain=${encodeURIComponent(chain)}&launchpad=${encodeURIComponent(launchpad)}&view=${view}`, { signal, timeoutMs: 30_000 }),
  newPairs: (chain: SniperChain, signal?: AbortSignal) =>
    apiGet<{ chain: string; tokens: SniperToken[]; updatedAt: string | null }>(`/api/sniper/new?chain=${chain}`, { signal }),
  search: (q: string, chain?: SniperChain, signal?: AbortSignal) =>
    apiGet<SniperToken[]>(`/api/sniper/search?q=${encodeURIComponent(q)}${chain ? `&chain=${chain}` : ''}`, { signal }),
  refresh: (ids: string[], signal?: AbortSignal) =>
    ids.length === 0 ? Promise.resolve([] as SniperToken[]) : apiGet<SniperToken[]>(`/api/sniper/tokens?ids=${encodeURIComponent(ids.join(','))}`, { signal }),
  security: (chain: SniperChain, address: string, signal?: AbortSignal) =>
    apiGet<Security>(`/api/sniper/security?chain=${chain}&address=${encodeURIComponent(address)}`, { signal }),
};

/** Whether a plain token (search result or tracked token) passes the basic filters. A missing risk report never counts as safe. */
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

/**
 * Whether a scored feed token passes every filter. This is what the auto sniper obeys.
 * Anything unknown counts against the token: unchecked, no trades to read, no risk report.
 */
export function judge(token: FeedToken, f: SniperFilters, chainHasRiskChecks: boolean): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { score, developer, security } = token;
  if (!score.checked) reasons.push('Still being checked');
  if (score.blocked) reasons.push(score.warnings[0] ?? 'A serious risk was found');
  if (score.total < f.minScore) reasons.push(`Score ${score.total} is below your minimum of ${f.minScore}`);
  if (token.buyRatioPct == null) reasons.push('Too few trades to read demand');
  else if (token.buyRatioPct < f.minBuyRatioPct) reasons.push(`Only ${token.buyRatioPct.toFixed(0)}% of recent trades are buys`);
  // A bonding curve takes the other side of every trade, so pool depth does not apply to it.
  if (!token.onCurve && token.liquidityUsd < f.minLiquidityUsd) reasons.push('Liquidity is below your minimum');
  if (developer?.holdingPct != null && developer.holdingPct > f.maxDevHoldingPct) reasons.push(`Developer holds ${developer.holdingPct.toFixed(1)}%`);
  if (f.minDevSuccessPct > 0) {
    const rate = developer?.record.successRate;
    if (rate == null) reasons.push('Developer has no track record yet');
    else if (rate < f.minDevSuccessPct) reasons.push(`Developer success rate is ${rate.toFixed(0)}%`);
  }
  if (security?.available) {
    if (security.isHoneypot) reasons.push('Flagged as a honeypot');
    if (security.riskScore > f.maxRiskScore) reasons.push(`Risk score ${security.riskScore} is above your limit`);
    if (Math.max(security.buyTaxPct ?? 0, security.sellTaxPct ?? 0) > f.maxTaxPct) reasons.push('Trade tax is above your limit');
  } else if (chainHasRiskChecks && score.checked) {
    reasons.push('No contract risk data available');
  }
  return { ok: reasons.length === 0, reasons };
}

export interface SnipeRecord {
  /** Snipes that have been sold out completely. */
  closed: number;
  wins: number;
  /** 0 to 100, or null before any snipe has been closed. */
  winRatePct: number | null;
  /** Profit booked so far, part sales of snipes that are still open included. */
  realizedUsd: number;
}

interface RecordFill {
  key: string;
  side: string;
  qty: number;
  time: number;
  realizedPnlUsd?: number | null;
}

/**
 * The sniper's real record, measured from paper snipes. A snipe sold in several steps (take
 * profit 1, then 2, then the rest) counts as one trade, won if the steps add up to a profit.
 */
export function snipeRecord(fills: RecordFill[]): SnipeRecord {
  // Sniper positions are keyed "chain:address". Terminal positions are keyed by symbol.
  const byToken = new Map<string, RecordFill[]>();
  // Fills are stored newest first. Reversing first keeps same instant sales in the order they happened.
  for (const f of [...fills].reverse()) {
    if (!f.key.includes(':')) continue;
    const list = byToken.get(f.key);
    if (list) list.push(f);
    else byToken.set(f.key, [f]);
  }
  let closed = 0;
  let wins = 0;
  let realizedUsd = 0;
  for (const list of byToken.values()) {
    let held = 0;
    let bought = 0;
    let pnl = 0;
    for (const f of list.sort((a, b) => a.time - b.time)) {
      if (f.side === 'buy') {
        held += f.qty;
        bought += f.qty;
        continue;
      }
      held -= f.qty;
      pnl += f.realizedPnlUsd ?? 0;
      realizedUsd += f.realizedPnlUsd ?? 0;
      // Nothing left (or the buy has dropped off the end of the history): the trade is finished.
      if (held <= Math.max(bought, f.qty) * 1e-6) {
        closed += 1;
        if (pnl > 0) wins += 1;
        held = 0;
        bought = 0;
        pnl = 0;
      }
    }
  }
  return { closed, wins, winRatePct: closed > 0 ? (wins / closed) * 100 : null, realizedUsd };
}

const CHAIN_NAMES: Record<string, string> = {
  solana: 'Solana', bsc: 'BNB Chain', base: 'Base', avalanche: 'Avalanche', near: 'NEAR', robinhood: 'Robinhood Chain',
  ethereum: 'Ethereum', arbitrum: 'Arbitrum', polygon: 'Polygon', sui: 'Sui', ton: 'TON', tron: 'Tron', monad: 'Monad',
  abstract: 'Abstract', hyperevm: 'HyperEVM', sonic: 'Sonic', berachain: 'Berachain',
};

export function chainLabel(chain: string): string {
  return CHAIN_NAMES[chain] ?? chain;
}
