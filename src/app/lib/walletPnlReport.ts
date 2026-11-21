// Loads a Solana wallet's profit and loss report: its trades from chain history, valued with
// SOL's price at each trade's time and today's token prices. Shared by the Trade Book, the AI
// assistant and the whale grades, and kept for a few minutes so they never read twice.

import { useEffect, useState } from 'react';
import { portfolioService } from '../services/portfolioService';
import { tokenPairs, usdPriceOf } from '../swap/dexscreener';
import { loadWalletHistory, type WalletTx } from '../swap/solanaHistory';
import { solPriceLookup } from './solPriceHistory';
import { computePnl, STABLE_MINTS, WSOL_MINT, type WalletPnl } from './walletPnl';

export interface Names {
  [mint: string]: { symbol: string; name: string };
}

export interface PnlReport {
  address: string;
  pnl: WalletPnl;
  names: Names;
  txs: WalletTx[];
  scanned: number;
  oldest: string | null;
  complete: boolean;
  at: number;
}

/** Names for mints the portfolio did not list, from Jupiter's token list. */
async function namesFor(mints: string[]): Promise<Names> {
  const out: Names = {};
  for (let i = 0; i < mints.length; i += 100) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 100).join(',')}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const list = res.ok ? ((await res.json()) as Array<{ id?: string; symbol?: string; name?: string }>) : [];
      for (const t of Array.isArray(list) ? list : []) if (t.id && t.symbol) out[t.id] = { symbol: String(t.symbol).slice(0, 16), name: String(t.name ?? '').slice(0, 40) };
    } catch {
      /* names are a nicety */
    }
  }
  return out;
}

const reports = new Map<string, PnlReport>();
const inflight = new Map<string, Promise<PnlReport>>();
const FRESH_MS = 5 * 60_000;

export function cachedReport(address: string): PnlReport | null {
  return reports.get(address) ?? null;
}

/**
 * Reads the wallet's last `limit` transactions (or, with `older`, the ones before that report)
 * and works out its profit and loss.
 */
export async function loadPnlReport(
  address: string,
  { older, limit = 500, deep = true, onProgress, signal }: {
    older?: PnlReport | null;
    limit?: number;
    /** Keep reading further back (up to four pages) while a held token has no buy found yet. */
    deep?: boolean;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<PnlReport> {
  const portfolio = await portfolioService.get(address, signal).catch(() => null);
  const heldMints = (portfolio?.holdings ?? []).filter((h) => h.address && !STABLE_MINTS[h.address] && h.address !== WSOL_MINT && (h.valueUsd ?? 0) >= 0.5).map((h) => h.address as string);

  const all = new Map<string, WalletTx>();
  for (const t of older?.txs ?? []) all.set(t.sig, t);
  let scanned = older?.scanned ?? 0;
  let before = older?.oldest ?? undefined;
  let oldest: string | null = older?.oldest ?? null;
  let complete = false;
  for (let round = 0; round < (deep ? 4 : 1); round++) {
    const base = scanned;
    const history = await loadWalletHistory(address, { limit, before, signal, onProgress: (d, t) => onProgress?.(base + d, base + t) });
    for (const t of history.txs) all.set(t.sig, t);
    scanned += history.scanned;
    oldest = history.oldest;
    complete = history.complete;
    before = history.oldest ?? undefined;
    if (complete || !oldest) break;
    // Stop once every token held has a buy among the transactions read.
    const bought = new Set([...all.values()].flatMap((t) => t.tokens.filter((k) => BigInt(k.delta) > 0n).map((k) => k.mint)));
    if (heldMints.every((m) => bought.has(m))) break;
  }
  const txs = [...all.values()].sort((a, b) => a.time - b.time);
  const solAt = await solPriceLookup(txs.filter((t) => t.sol !== '0').map((t) => t.time));
  const prices = new Map<string, number>();
  const holdings = new Map<string, number>();
  const names: Names = {};
  for (const h of portfolio?.holdings ?? []) {
    if (!h.address) continue;
    if (h.priceUsd != null) prices.set(h.address, h.priceUsd);
    holdings.set(h.address, h.amount);
    names[h.address] = { symbol: h.symbol, name: h.name };
  }
  let pnl = computePnl(txs, solAt, prices, portfolio ? holdings : undefined);
  // Prices for tokens still held that the portfolio did not price.
  const missing = pnl.tokens.filter((t) => t.heldQty > 0 && t.priceUsd == null).slice(0, 12);
  if (missing.length) {
    await Promise.all(missing.map(async (t) => {
      const p = await tokenPairs('solana', t.mint).then((pairs) => usdPriceOf(pairs, t.mint)).catch(() => null);
      if (p) prices.set(t.mint, p);
    }));
    pnl = computePnl(txs, solAt, prices, portfolio ? holdings : undefined);
  }
  // Every token held is listed, even one with no buy found, so nothing in the wallet is missing.
  for (const h of portfolio?.holdings ?? []) {
    if (!h.address || pnl.tokens.some((t) => t.mint === h.address)) continue;
    pnl.tokens.push({
      mint: h.address, buys: 0, sells: 0, investedUsd: 0, proceedsUsd: 0, realizedUsd: 0, heldQty: 0, costUsd: 0, untrackedQty: h.amount,
      avgCostUsd: null, priceUsd: h.priceUsd, valueUsd: null, unrealizedUsd: null, totalUsd: 0, firstAt: 0, lastAt: 0,
      nowQty: h.amount, nowUsd: h.valueUsd, noTrade: true,
    });
  }
  Object.assign(names, await namesFor(pnl.tokens.map((t) => t.mint).filter((m) => !names[m])));
  const report: PnlReport = { address, pnl, names, txs, scanned, oldest, complete, at: Date.now() };
  reports.set(address, report);
  return report;
}

/** The report for a wallet, read once and shared; fresh for five minutes. */
export function sharedReport(address: string, limit = 500): Promise<PnlReport> {
  const hit = reports.get(address);
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit);
  let p = inflight.get(address);
  if (!p) {
    p = loadPnlReport(address, { limit }).finally(() => inflight.delete(address));
    inflight.set(address, p);
  }
  return p;
}

/** The wallet's report, loading it in the background. Null until ready. */
export function useWalletPnlReport(address: string | null): PnlReport | null {
  const [state, setState] = useState<PnlReport | null>(() => (address ? cachedReport(address) : null));
  useEffect(() => {
    if (!address) return;
    let live = true;
    sharedReport(address).then((r) => live && setState(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, [address]);
  return state && state.address === address ? state : null;
}
