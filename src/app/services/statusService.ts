import { apiGet } from './api';

export interface SourceHealth {
  name: string;
  ok: boolean;
  lastSuccess: string | null;
  lastAttempt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  failures: number;
}

export interface ServiceStatus {
  version: string;
  /** 'server' keeps data hot with pollers and streams. 'on_demand' refreshes per request (serverless). */
  mode?: 'server' | 'on_demand';
  realtime?: boolean;
  startedAt: string;
  uptimeSecs: number;
  sources: SourceHealth[];
  database: { configured: boolean; connected: boolean };
  ai: { configured: boolean };
  data: { tickers: number; tickersSource: string; coins: number; newsArticles: number; whaleEvents: number };
}

export const statusService = {
  get: (signal?: AbortSignal) => apiGet<ServiceStatus>('/api/status', { signal }),
};
