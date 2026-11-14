// Client for the Arctos Rust data service.
//
// By default requests go to the same site that serves the web app:
//   * on Vercel the service runs as a function behind /api (see api/main.rs),
//   * in development Vite proxies /api and /ws to a local service.
// Set VITE_RUST_BACKEND_URL only when the service is hosted somewhere else.

const RAW_BASE = (import.meta.env.VITE_RUST_BACKEND_URL ?? '').trim().replace(/\/+$/, '');

export const API_BASE = RAW_BASE;

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(path: string, init: RequestInit, { signal, timeoutMs = 15_000 }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) {
      let message = `The data service answered with status ${response.status}.`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* keep the generic message */
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new ApiError('The data service took too long to respond.', 0);
    throw new ApiError('Could not reach the Arctos data service.', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>(path, { method: 'GET' }, options);
}

export function apiPost<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, options);
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function wsUrl(path: string): string {
  if (RAW_BASE) return `${RAW_BASE.replace(/^http/i, 'ws')}${path}`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

export type SocketStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'unavailable';

let realtimeCheck: Promise<boolean> | null = null;

/**
 * Whether the data service offers live WebSocket streams. A serverless deployment does not,
 * and the app polls instead. The answer is fetched once and shared.
 */
export function realtimeAvailable(): Promise<boolean> {
  if (!realtimeCheck) {
    realtimeCheck = apiGet<{ realtime?: boolean }>('/api/status', { timeoutMs: 10_000 })
      .then((status) => status.realtime === true)
      .catch(() => {
        // Ask again next time instead of remembering a failure.
        realtimeCheck = null;
        return false;
      });
  }
  return realtimeCheck;
}

/**
 * Opens a WebSocket that reconnects with backoff. Returns a function that closes it for good.
 * When the service has no live streams the status becomes 'unavailable' and nothing is opened,
 * so callers keep polling.
 */
export function openSocket(
  path: string,
  onMessage: (data: unknown) => void,
  onStatus?: (status: SocketStatus) => void,
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      socket = new WebSocket(wsUrl(path));
    } catch {
      schedule();
      return;
    }
    socket.onopen = () => {
      attempt = 0;
      onStatus?.('live');
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(String(event.data)));
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      if (!closed) schedule();
    };
    socket.onerror = () => socket?.close();
  };

  const schedule = () => {
    attempt += 1;
    onStatus?.('reconnecting');
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
    timer = setTimeout(connect, delay);
  };

  onStatus?.('connecting');
  void realtimeAvailable().then((available) => {
    if (closed) return;
    if (available) connect();
    else onStatus?.('unavailable');
  });
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    socket?.close();
    onStatus?.('closed');
  };
}
