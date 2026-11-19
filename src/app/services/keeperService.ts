// Client for the trade keeper in the data service. The keeper decides when an open snipe is
// sold (take profit targets, stop loss, developer exit guard). This app books what it decides.

import { apiPost, withLists } from './api';
import type { KeeperPlan } from '../lib/exitPlan';

export interface KeeperGuard {
  /** The developer's share of supply when the trade was opened, in percent. */
  devBasePct: number | null;
  devNowPct: number | null;
  devCheckedAt: number | null;
  /** How much of that share is gone, in percent of the share at entry. */
  devSoldPct: number | null;
  pool: string | null;
  liqRefUsd: number | null;
  /** Liquidity withdrawn from the pool beyond what the price move explains, in percent. */
  liqRemovedPct: number | null;
}

/** One open snipe as the keeper tracks it. Stored as is and sent back on the next sync. */
export interface KeeperPosition {
  key: string;
  symbol: string;
  entryPrice: number;
  qty: number;
  /** The size the take profit shares refer to. */
  basisQty: number;
  plan: KeeperPlan;
  /** Take profit levels already sold. */
  tpDone: number[];
  guard: KeeperGuard;
  last: { priceUsd: number; liquidityUsd: number | null; at: number } | null;
  closed: string | null;
  /** True when the keeper holds this trade and checks it with the app closed. */
  offline: boolean;
}

export interface KeeperSale {
  id: string;
  key: string;
  rule: string;
  note: string;
  detail: string;
  qty: number;
  priceUsd: number;
  at: number;
}

export interface KeeperSyncResponse {
  /** `offline`: trades are checked with the app closed. `page`: only while it is open. */
  mode: 'offline' | 'page';
  durable: boolean;
  lastBackgroundCheck: number | null;
  positions: KeeperPosition[];
  executions: KeeperSale[];
  /** Positions the keeper could not take on. */
  rejected: Array<{ key: string; reason: string }>;
  checkedAt: number;
}

/** Open snipes the keeper manages for one browser. */
export const MAX_MANAGED_SNIPES = 12;

/** The keeper's state for a position, read back from where the paper account keeps it. */
export function keeperStateOf(position: { key: string; keeper?: Record<string, unknown> }): KeeperPosition | null {
  const k = position.keeper;
  if (!k || k.key !== position.key || !Array.isArray(k.tpDone) || typeof k.guard !== 'object' || k.guard === null) return null;
  return k as unknown as KeeperPosition;
}

export interface KeeperReport {
  key: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  plan: KeeperPlan;
  devHoldingPct?: number;
  openedAt: number;
  /** Whatever the keeper returned for this position last time. */
  state?: unknown;
}

const DEVICE_KEY = 'arctos_keeper_key';
let memoryKey: string | null = null;

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A random secret that identifies this browser to the keeper. It is what lets the keeper hand
 * back the right trades after the app was closed. The keeper only ever stores a hash of it.
 */
export function deviceKey(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && /^[A-Za-z0-9_-]{32,128}$/.test(stored)) return stored;
    const fresh = randomKey();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Storage is blocked: the key lasts for this visit only.
    memoryKey ??= randomKey();
    return memoryKey;
  }
}

/** True when this browser has talked to the keeper before, so the keeper may still hold trades for it. */
export function hasDeviceKey(): boolean {
  try {
    return localStorage.getItem(DEVICE_KEY) !== null;
  } catch {
    return false;
  }
}

export const keeperService = {
  sync: (positions: KeeperReport[], ack: string[], signal?: AbortSignal) =>
    apiPost<KeeperSyncResponse>(
      '/api/sniper/keeper/sync',
      { positions, ack },
      { signal, timeoutMs: 25_000, headers: { Authorization: `Bearer ${deviceKey()}` }, check: withLists('positions', 'executions') },
    ),
};
