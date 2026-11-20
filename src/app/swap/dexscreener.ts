// DexScreener's public API, called straight from the browser (it allows that and gives each
// visitor their own rate limit). Answers are read strictly and kept briefly, so switching
// tabs or tokens back and forth never waits on the network twice.

import { safeHref } from '../lib/format';
import { CHAINS, type SwapChain } from './chains';

export const DEX_API = 'https://api.dexscreener.com';

type Periods<T> = { m5: T | null; h1: T | null; h6: T | null; h24: T | null };
export const PERIODS = ['m5', 'h1', 'h6', 'h24'] as const;

export interface DexLink {
  label: string;
  url: string;
  type: string;
}

export interface DexPair {
  chain: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels: string[];
  base: { address: string; name: string; symbol: string };
  quote: { address: string; name: string; symbol: string };
  priceUsd: number | null;
  priceNative: number | null;
  change: Periods<number>;
  volume: Periods<number>;
  txns: Periods<{ buys: number; sells: number }>;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  createdAt: number | null;
  imageUrl: string | null;
  header: string | null;
  websites: DexLink[];
  socials: DexLink[];
  boosts: number;
}

const PAIR_ID = /^[A-Za-z0-9]{20,66}$/;
const TOKEN_ID = /^[A-Za-z0-9]{20,66}$/;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** Printable text on one line, without characters that could pass for markup. */
const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? [...v].map((c) => (c.charCodeAt(0) < 32 || c === '<' || c === '>' ? ' ' : c)).join('').trim().slice(0, max) : '';
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Only DexScreener's own image hosts, over https. */
function image(v: unknown): string | null {
  const href = safeHref(typeof v === 'string' ? v : null);
  if (!href || !href.startsWith('https://')) return null;
  const host = new URL(href).hostname;
  return host === 'dexscreener.com' || host.endsWith('.dexscreener.com') ? href : null;
}

function links(v: unknown, kind: 'website' | 'social'): DexLink[] {
  if (!Array.isArray(v)) return [];
  const out: DexLink[] = [];
  for (const raw of v.slice(0, 12)) {
    const r = rec(raw);
    const url = safeHref(typeof r.url === 'string' ? r.url : null);
    if (!url || !url.startsWith('https://')) continue;
    const type = kind === 'website' ? 'website' : text(r.type, 20).toLowerCase() || 'link';
    out.push({ url, type, label: text(r.label, 40) || (kind === 'website' ? 'Website' : type) });
  }
  return out;
}

function periods<T>(v: unknown, read: (x: unknown) => T | null): Periods<T> {
  const r = rec(v);
  return { m5: read(r.m5), h1: read(r.h1), h6: read(r.h6), h24: read(r.h24) };
}

function tokenOf(v: unknown) {
  const r = rec(v);
  return { address: typeof r.address === 'string' && TOKEN_ID.test(r.address) ? r.address : '', name: text(r.name, 60), symbol: text(r.symbol, 20) };
}

/** Reads DexScreener pairs, dropping anything malformed, deepest pool first. */
export function readPairs(body: unknown): DexPair[] {
  const list = Array.isArray(body) ? body : Array.isArray(rec(body).pairs) ? (rec(body).pairs as unknown[]) : [];
  const out: DexPair[] = [];
  for (const raw of list) {
    const p = rec(raw);
    if (typeof p.pairAddress !== 'string' || !PAIR_ID.test(p.pairAddress) || typeof p.chainId !== 'string') continue;
    const base = tokenOf(p.baseToken);
    if (!base.address) continue;
    const info = rec(p.info);
    const url = typeof p.url === 'string' && p.url.startsWith('https://dexscreener.com/') ? p.url : `https://dexscreener.com/${encodeURIComponent(p.chainId)}/${p.pairAddress}`;
    out.push({
      chain: text(p.chainId, 20),
      dexId: text(p.dexId, 30) || 'dex',
      url,
      pairAddress: p.pairAddress,
      labels: Array.isArray(p.labels) ? p.labels.map((l) => text(l, 12)).filter(Boolean).slice(0, 4) : [],
      base,
      quote: tokenOf(p.quoteToken),
      priceUsd: num(p.priceUsd),
      priceNative: num(p.priceNative),
      change: periods(p.priceChange, num),
      volume: periods(p.volume, num),
      txns: periods(p.txns, (x) => {
        const t = rec(x);
        const buys = num(t.buys);
        const sells = num(t.sells);
        return buys == null || sells == null ? null : { buys, sells };
      }),
      liquidityUsd: num(rec(p.liquidity).usd),
      fdv: num(p.fdv),
      marketCap: num(p.marketCap),
      createdAt: num(p.pairCreatedAt),
      imageUrl: image(info.imageUrl),
      header: image(info.header),
      websites: links(info.websites, 'website'),
      socials: links(info.socials, 'social'),
      boosts: num(rec(p.boosts).active) ?? 0,
    });
  }
  return out.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

const cache = new Map<string, { at: number; value: Promise<DexPair[]> }>();

function cached(key: string, ttlMs: number, load: () => Promise<DexPair[]>): Promise<DexPair[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(res.status === 429 ? 'DexScreener is busy, try again in a moment.' : `DexScreener answered ${res.status}.`);
  return res.json();
}

/** Every pool of a token on one chain, deepest first. Kept for 30 seconds. */
export function tokenPairs(chainSlug: string, address: string): Promise<DexPair[]> {
  return cached(`t:${chainSlug}:${address}`, 30_000, async () =>
    readPairs(await getJson(`${DEX_API}/tokens/v1/${encodeURIComponent(chainSlug)}/${encodeURIComponent(address)}`)));
}

const BY_SLUG = new Map(CHAINS.map((c) => [c.dexscreener, c]));

export function chainForSlug(slug: string): SwapChain | undefined {
  return BY_SLUG.get(slug);
}

/** Tokens matching a name, symbol or address on the chains Arctos can swap, one row per token. */
export function searchDex(query: string): Promise<DexPair[]> {
  const q = query.trim().slice(0, 64);
  return cached(`s:${q.toLowerCase()}`, 60_000, async () => {
    const pairs = readPairs(await getJson(`${DEX_API}/latest/dex/search?q=${encodeURIComponent(q)}`));
    const seen = new Set<string>();
    return pairs.filter((p) => {
      const key = `${p.chain}:${p.base.address.toLowerCase()}`;
      if (!BY_SLUG.has(p.chain) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/** The pools where the token is the base token come first: their price is the token's own. */
export function ownPairsFirst(pairs: DexPair[], address: string): DexPair[] {
  const a = address.toLowerCase();
  return [...pairs.filter((p) => p.base.address.toLowerCase() === a), ...pairs.filter((p) => p.base.address.toLowerCase() !== a)];
}

/** A token's US dollar price from its pools, read from whichever side of the pool it is on. */
export function usdPriceOf(pairs: DexPair[], address: string): number | null {
  const a = address.toLowerCase();
  const own = pairs.find((p) => p.base.address.toLowerCase() === a && p.priceUsd != null && p.priceUsd > 0);
  if (own?.priceUsd) return own.priceUsd;
  const quoted = pairs.find((p) => p.quote.address.toLowerCase() === a && p.priceUsd && p.priceNative);
  return quoted?.priceUsd && quoted.priceNative ? quoted.priceUsd / quoted.priceNative : null;
}
