import { apiGet } from './api';

export type WhaleKind = 'transfer' | 'exchange_inflow' | 'exchange_outflow';

export interface WhaleEvent {
  id: string;
  chain: string;
  chainName: string;
  asset: string;
  amount: number;
  valueUsd: number;
  from: string | null;
  to: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  kind: WhaleKind;
  txHash: string;
  block: number | null;
  timestamp: number;
  explorerUrl: string;
}

export interface ChainStatus {
  chain: string;
  name: string;
  supported: boolean;
  ok: boolean;
  lastBlock: number | null;
  lastPoll: string | null;
  note: string;
}

export interface WhaleResponse {
  events: WhaleEvent[];
  stats: { count: number; largestUsd: number; totalUsd: number; averageUsd: number };
  chains: ChainStatus[];
  minUsdFloor: number;
}

export const whaleService = {
  list: (params: { minUsd?: number; chain?: string; limit?: number } = {}, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (params.minUsd) q.set('minUsd', String(params.minUsd));
    if (params.chain) q.set('chain', params.chain);
    q.set('limit', String(params.limit ?? 200));
    return apiGet<WhaleResponse>(`/api/whales?${q.toString()}`, { signal });
  },
};
