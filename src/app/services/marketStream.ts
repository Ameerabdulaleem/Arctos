// One shared live ticker feed for the whole app. It uses the data service WebSocket when the
// service offers one, and polls otherwise (always the case on a serverless deployment).

import { openSocket, type SocketStatus } from './api';
import { marketService, type Ticker } from './marketService';

export interface TickerSnapshot {
  tickers: Record<string, Ticker>;
  status: SocketStatus | 'polling';
  updatedAt: number | null;
  error: string | null;
}

// Prices are cached for two seconds at the edge, so polling faster gains nothing.
const POLL_MS = 3000;

const EMPTY: TickerSnapshot = { tickers: {}, status: 'connecting', updatedAt: null, error: null };

let snapshot: TickerSnapshot = EMPTY;
const listeners = new Set<() => void>();
let closeSocket: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let socketLive = false;

function emit(next: Partial<TickerSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function apply(list: Ticker[]) {
  const tickers = { ...snapshot.tickers };
  for (const t of list) tickers[t.base] = t;
  emit({ tickers, updatedAt: Date.now(), error: null });
}

async function pollOnce() {
  try {
    const { tickers } = await marketService.tickers();
    apply(tickers);
  } catch (e) {
    emit({ error: e instanceof Error ? e.message : 'Prices are unavailable.' });
  }
}

function start() {
  void pollOnce();
  closeSocket = openSocket(
    '/ws/market',
    (msg) => {
      const m = msg as { type?: string; data?: Ticker[] };
      if (m.type === 'tickers' && Array.isArray(m.data)) apply(m.data);
    },
    (status) => {
      socketLive = status === 'live';
      emit({ status: socketLive ? 'live' : status === 'closed' ? 'closed' : 'polling' });
    },
  );
  pollTimer = setInterval(() => {
    if (!socketLive && !document.hidden) void pollOnce();
  }, POLL_MS);
}

function stop() {
  closeSocket?.();
  closeSocket = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  socketLive = false;
  snapshot = EMPTY;
}

export const tickerStore = {
  subscribe(listener: () => void): () => void {
    if (listeners.size === 0) start();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },
  getSnapshot(): TickerSnapshot {
    return snapshot;
  },
};
