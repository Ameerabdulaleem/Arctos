// Reads a Solana wallet's past transactions from public RPCs and keeps, for each one, how the
// wallet's SOL and token balances changed. Chain history never changes, so each transaction is
// read once and kept on this device; later visits only read what is new.

import { SOL_MINT } from './chains';
import { solanaCall } from './solanaRpc';

/** One transaction, reduced to the wallet's balance changes. Amounts are base unit strings. */
export interface WalletTx {
  sig: string;
  /** Unix milliseconds. */
  time: number;
  fee: string;
  /** SOL change without the network fee or token account rent, wrapped SOL included. */
  sol: string;
  tokens: Array<{ mint: string; delta: string; decimals: number }>;
}

/** Rent for a new token account, paid when a token is first bought and returned when closed. */
const TOKEN_ACCOUNT_RENT = 2_039_280n;

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const big = (v: unknown): bigint => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : 0n);

/** Reduces a jsonParsed transaction to the wallet's balance changes, or null if it changed nothing or failed. */
export function parseWalletTx(raw: unknown, wallet: string, sig: string): WalletTx | null {
  const tx = rec(raw);
  const meta = rec(tx.meta);
  if (meta.err != null || typeof tx.blockTime !== 'number') return null;
  const message = rec(rec(tx.transaction).message);
  const keys = (Array.isArray(message.accountKeys) ? message.accountKeys : []).map((k) => (typeof k === 'string' ? k : String(rec(k).pubkey ?? '')));
  const idx = keys.indexOf(wallet);
  const fee = big(meta.fee);
  const pre = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const post = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  let sol = idx >= 0 ? big(post[idx]) - big(pre[idx]) : 0n;
  if (idx === 0) sol += fee; // the fee payer's fee is not part of the trade

  // Token balances owned by the wallet, summed per mint before and after.
  const sums = new Map<string, { before: bigint; after: bigint; decimals: number; had: boolean; has: boolean }>();
  const add = (list: unknown, side: 'before' | 'after') => {
    for (const b of Array.isArray(list) ? list : []) {
      const r = rec(b);
      if (r.owner !== wallet || typeof r.mint !== 'string') continue;
      const ui = rec(r.uiTokenAmount);
      const e = sums.get(r.mint) ?? { before: 0n, after: 0n, decimals: Number(ui.decimals) || 0, had: false, has: false };
      e[side] += big(ui.amount);
      if (side === 'before') e.had = true;
      else e.has = true;
      sums.set(r.mint, e);
    }
  };
  add(meta.preTokenBalances, 'before');
  add(meta.postTokenBalances, 'after');

  const tokens: WalletTx['tokens'] = [];
  for (const [mint, e] of sums) {
    const delta = e.after - e.before;
    if (mint === SOL_MINT) {
      sol += delta; // wrapped SOL is SOL
      continue;
    }
    // A token account opened or closed here moved rent, which is not part of the trade.
    if (!e.had && e.has && sol < 0n) sol += TOKEN_ACCOUNT_RENT;
    if (e.had && !e.has && sol > 0n) sol -= TOKEN_ACCOUNT_RENT;
    if (delta !== 0n) tokens.push({ mint, delta: delta.toString(), decimals: e.decimals });
  }
  if (sol === 0n && tokens.length === 0) return null;
  return { sig, time: tx.blockTime * 1000, fee: fee.toString(), sol: sol.toString(), tokens };
}

// ------------------------------------------------------------------ cache

const CACHE_LIMIT = 3000;
const cacheKey = (wallet: string) => `arctos_txs_v1:${wallet}`;

/** Parsed transactions by signature; 0 marks one that changed nothing for the wallet. */
function readCache(wallet: string): Record<string, WalletTx | 0> {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(wallet)) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, WalletTx | 0>) : {};
  } catch {
    return {};
  }
}

function writeCache(wallet: string, cache: Record<string, WalletTx | 0>) {
  try {
    const entries = Object.entries(cache);
    const kept = entries.length > CACHE_LIMIT ? entries.sort((a, b) => (b[1] ? b[1].time : 0) - (a[1] ? a[1].time : 0)).slice(0, CACHE_LIMIT) : entries;
    localStorage.setItem(cacheKey(wallet), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or blocked: the history is read again next time */
  }
}

export interface HistoryResult {
  txs: WalletTx[];
  /** Signatures looked at. */
  scanned: number;
  /** Signature of the oldest transaction read, to read further back from. */
  oldest: string | null;
  /** True when there is no older history. */
  complete: boolean;
}

/**
 * Reads up to `limit` of the wallet's most recent transactions (or those before `before`).
 * `onProgress` reports how many have been read.
 */
export async function loadWalletHistory(
  wallet: string,
  { limit = 300, before, onProgress, signal }: { limit?: number; before?: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<HistoryResult> {
  const sigs = await solanaCall<Array<{ signature: string; err: unknown }>>(
    'getSignaturesForAddress',
    [wallet, { limit: Math.min(1000, limit), ...(before ? { before } : {}), commitment: 'confirmed' }],
    signal,
  );
  const ok = sigs.filter((s) => s.err == null).map((s) => s.signature);
  const cache = readCache(wallet);
  const missing = ok.filter((s) => !(s in cache));
  let done = ok.length - missing.length;
  onProgress?.(done, ok.length);

  // A few at a time, so public RPCs do not refuse the burst.
  let next = 0;
  let sinceSave = 0;
  const worker = async () => {
    while (next < missing.length) {
      if (signal?.aborted) return;
      const sig = missing[next++];
      try {
        const raw = await solanaCall<unknown>('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], signal);
        cache[sig] = parseWalletTx(raw, wallet, sig) ?? 0;
      } catch {
        // Left out of the cache, so it is tried again next time.
        await new Promise((r) => setTimeout(r, 400));
      }
      done += 1;
      onProgress?.(done, ok.length);
      if (++sinceSave >= 25) {
        sinceSave = 0;
        writeCache(wallet, cache);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  writeCache(wallet, cache);

  const txs = ok.map((s) => cache[s]).filter((t): t is WalletTx => Boolean(t)).sort((a, b) => a.time - b.time);
  return { txs, scanned: ok.length, oldest: sigs.length ? sigs[sigs.length - 1].signature : null, complete: sigs.length < Math.min(1000, limit) };
}
