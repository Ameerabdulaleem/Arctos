import { apiGet, apiPost } from './api';

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
}

export const aiService = {
  status: (signal?: AbortSignal) => apiGet<{ configured: boolean; model: string | null }>('/api/ai/status', { signal }),
  chat: (messages: ChatTurn[], context: UserContext, signal?: AbortSignal) =>
    apiPost<{ reply: string; model: string }>('/api/ai/chat', { messages, context }, { signal, timeoutMs: 100_000 }),
};
