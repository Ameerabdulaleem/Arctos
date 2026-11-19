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

/** Says whether an answer has the shape a page relies on. */
export type Check = (value: unknown) => boolean;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object whose named fields are all lists. */
export const withLists = (...keys: string[]): Check => (v) => isRecord(v) && keys.every((k) => Array.isArray(v[k]));

/** An object that has every named field (any value, null included). */
export const withFields = (...keys: string[]): Check => (v) => isRecord(v) && keys.every((k) => k in v);

/** Both checks must pass. */
export const both = (a: Check, b: Check): Check => (v) => a(v) && b(v);

export const isList: Check = (v) => Array.isArray(v);

/**
 * What a page shows when an answer is not what it expects. This happens when the address
 * serves something other than the data service, for example a removed or protected deployment.
 */
export const UNEXPECTED_ANSWER = 'The data service sent an answer this page could not read. Open the main site address and reload.';

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra request headers, for example a bearer token. */
  headers?: Record<string, string>;
  /**
   * The shape the caller relies on. Without one, any JSON object or list is accepted.
   * An answer that fails it becomes an error, so a page never renders data it cannot read.
   */
  check?: Check;
}

async function request<T>(path: string, init: RequestInit, { signal, timeoutMs = 15_000, check }: RequestOptions = {}): Promise<T> {
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
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(UNEXPECTED_ANSWER, response.status);
    }
    // A successful status carrying an error message is still an error.
    if (isRecord(body) && typeof body.error === 'string' && Object.keys(body).length === 1) {
      throw new ApiError(body.error, response.status);
    }
    const valid = check ? check(body) : typeof body === 'object' && body !== null;
    if (!valid) throw new ApiError(UNEXPECTED_ANSWER, response.status);
    return body as T;
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
  return request<T>(path, { method: 'POST', headers: { ...options?.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, options);
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
