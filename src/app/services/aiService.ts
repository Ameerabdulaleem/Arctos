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
