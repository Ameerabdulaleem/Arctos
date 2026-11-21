import { apiGet, apiPost, withFields } from './api';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface UserContext {
  trades?: Array<{ tokenName: string; priceBought: number; amount: number; priceSold: number; profitLoss: number }>;
  paper?: {
    cashUsd: number;
    equityUsd: number;
    realizedPnlUsd: number;
    positions: Array<{ symbol: string; qty: number; avgPrice: number }>;
  };
  wallet?: { address?: string; totalUsd?: number };
  /** The wallets connected in this browser, with what they hold. Public data only. */
  wallets?: WalletContext[];
  /** The Trade Book's profit and loss for the connected Solana wallet, from its own trades. */
  walletPnl?: WalletPnlContext;
}

export interface WalletPnlContext {
  address: string;
  since: number | null;
  scanned: number;
  totals: { netUsd: number; realizedUsd: number; unrealizedUsd: number; profitUsd: number; lossUsd: number; trades: number; buys: number; sells: number; winRatePct: number | null; investedUsd: number; feesUsd: number };
  tokens: Array<{ symbol: string; mint: string; buys: number; sells: number; investedUsd: number; proceedsUsd: number; avgCostUsd: number | null; realizedUsd: number; heldQty: number; priceUsd: number | null; valueUsd: number | null; unrealizedUsd: number | null; totalUsd: number; firstAt: number; lastAt: number }>;
}

export interface WalletContext {
  address: string;
  kind: 'evm' | 'solana';
  totalUsd?: number;
  hiddenTokens?: number;
  holdings?: Array<{ symbol: string; name: string; chain: string; amount: number; valueUsd: number | null; change24h: number | null; address?: string }>;
}

export const aiService = {
  status: (signal?: AbortSignal) => apiGet<{ configured: boolean; model: string | null }>('/api/ai/status', { signal, check: withFields('configured') }),
  chat: (messages: ChatTurn[], context: UserContext, signal?: AbortSignal) =>
    apiPost<{ reply: string; model: string }>('/api/ai/chat', { messages, context }, { signal, timeoutMs: 100_000, check: (v) => typeof (v as { reply?: unknown })?.reply === 'string' }),
};
