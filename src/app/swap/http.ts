// Small, strict helpers for talking to swap providers and reading their answers.

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;
  /** The provider's error answer, for callers that read its error code. */
  readonly body: unknown;
  constructor(provider: string, message: string, status: number | null = null, body: unknown = null) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT = 12_000;

/** Picks a readable message out of the error bodies the providers send. */
export function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'title', 'reason']) {
    const v = b[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 240);
  }
  const errors = b.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
    const d = (errors[0] as Record<string, unknown>).detail ?? (errors[0] as Record<string, unknown>).message;
    if (typeof d === 'string') return d.slice(0, 240);
  }
  return null;
}

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Fetches JSON with a time limit. Errors carry the provider's own message when it sends one. */
export async function fetchJson(provider: string, url: string, opts: FetchOptions = {}): Promise<{ body: unknown; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const why = errorMessage(body) ?? (res.status === 429 ? 'too many requests right now' : `answered ${res.status}`);
      throw new ProviderError(provider, why, res.status, body);
    }
    return { body, headers: res.headers };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (opts.signal?.aborted) throw e;
    if (ctrl.signal.aborted) throw new ProviderError(provider, 'took too long to answer');
    throw new ProviderError(provider, 'could not be reached');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// Readers that refuse anything unexpected, so a strange answer can never turn into a transaction.

export function obj(provider: string, v: unknown, what: string): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new ProviderError(provider, `sent an answer without ${what}`);
}

export function bigOf(provider: string, v: unknown, what: string): bigint {
  if (typeof v === 'string' && /^\d{1,78}$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new ProviderError(provider, `sent an unreadable ${what}`);
}

export function bigOrNull(v: unknown): bigint | null {
  if (typeof v === 'string' && /^\d{1,78}$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

export function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function strOf(provider: string, v: unknown, what: string): string {
  if (typeof v === 'string' && v.length > 0) return v;
  throw new ProviderError(provider, `sent an answer without ${what}`);
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;

export function addressOf(provider: string, v: unknown, what: string): string {
  if (typeof v === 'string' && HEX_ADDRESS.test(v) && !/^0x0{40}$/.test(v)) return v;
  throw new ProviderError(provider, `sent an invalid ${what}`);
}

export function hexOf(provider: string, v: unknown, what: string): string {
  if (typeof v === 'string' && HEX_DATA.test(v) && v.length > 2) return v;
  throw new ProviderError(provider, `sent invalid ${what}`);
}

/** Applies a slippage tolerance to an amount. */
export function afterSlippage(amount: bigint, bps: number): bigint {
  const keep = BigInt(10_000 - Math.min(Math.max(Math.round(bps), 0), 10_000));
  return (amount * keep) / 10_000n;
}

export function unique(list: string[]): string[] {
  return [...new Set(list.filter((s) => s && s.trim()).map((s) => s.trim()))];
}
