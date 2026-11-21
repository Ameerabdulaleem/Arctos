import { apiGet, isRecord } from './api';
import type { SniperToken } from './sniperService';

export type SmartChain = 'solana' | 'bsc' | 'base';
export type Grade = 'A' | 'B' | 'C' | 'D';

/** A wallet's trades in one of the tokens scanned, valued at today's price. */
export interface SmartPosition extends SniperToken {
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  pnlUsd: number;
  roiPct: number;
  entryPrice: number;
  /** Today's price over the wallet's average entry. */
  multiple: number;
  heldPct: number;
  firstBuyAt: number;
}

export interface SmartWallet {
  address: string;
  chain: SmartChain;
  grade: Grade;
  score: number;
  wins: number;
  tokens: number;
  winRatePct: number;
  pnlUsd: number;
  investedUsd: number;
  roiPct: number;
  /** Tokens it got into at less than half of today's price. */
  earlyHits: number;
  lastActive: number;
  positions: SmartPosition[];
}

export interface ScannedToken extends SniperToken {
  /** Whale wallets found trading it. */
  whales: number;
}

export interface SmartResponse {
  chain: SmartChain;
  chainName: string;
  chains: SmartChain[];
  wallets: SmartWallet[];
  tokens: ScannedToken[];
  minTradeUsd: number;
  updatedAt: string;
}

export const SMART_CHAINS: Array<{ key: SmartChain; name: string }> = [
  { key: 'solana', name: 'Solana' },
  { key: 'bsc', name: 'BNB Chain' },
  { key: 'base', name: 'Base' },
];

export const smartMoneyService = {
  get: (chain: SmartChain, signal?: AbortSignal) =>
    apiGet<SmartResponse>(`/api/whales/smart?chain=${encodeURIComponent(chain)}`, {
      signal,
      // A cold scan reads several pools one after another.
      timeoutMs: 60_000,
      check: (v) => isRecord(v) && Array.isArray(v.wallets) && Array.isArray(v.tokens),
    }),
};
