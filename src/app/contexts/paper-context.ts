import { createContext, useContext } from 'react';
import type { AssetMeta, MarkedPosition, PaperAccount, PaperOrder, TradeResult } from '../lib/paperTrading';

export interface PaperContextType {
  account: PaperAccount;
  /** Latest live price per asset key (base symbol for exchange assets, chain:address for DEX tokens) */
  prices: Record<string, number>;
  equity: number;
  positionsValue: number;
  totalPnl: number;
  totalPnlPct: number;
  positions: MarkedPosition[];
  availableCash: number;
  buyMarket: (meta: AssetMeta, qty: number, price: number, options?: { takeProfitPct?: number; stopLossPct?: number; devHoldingPct?: number; note?: string }) => TradeResult;
  sellMarket: (key: string, qty: number, price: number) => TradeResult;
  placeLimit: (meta: AssetMeta, side: 'buy' | 'sell', price: number, qty: number) => { ok: true; order: PaperOrder } | { ok: false; error: string };
  cancelOrder: (id: string) => void;
  reset: () => void;
  /** How open sniper trades are being managed. */
  keeper: KeeperStatus;
  /** Asks the trade keeper for news now instead of waiting for the next round. */
  syncKeeper: () => void;
}

export interface KeeperStatus {
  /** `offline`: trades are checked with the app closed. `page`: only while it is open. Null until the keeper has answered. */
  mode: 'offline' | 'page' | null;
  /** False when the keeper holds trades in memory, which a restart of the service clears. */
  durable: boolean;
  /** Unix milliseconds of the keeper's last check that ran with nobody online. */
  lastBackgroundCheck: number | null;
  syncedAt: number | null;
  error: string | null;
  /** Position keys the keeper could not take on, with the reason. */
  rejected: Record<string, string>;
}

export const PaperContext = createContext<PaperContextType | undefined>(undefined);

export function usePaper(): PaperContextType {
  const ctx = useContext(PaperContext);
  if (!ctx) throw new Error('usePaper must be used within a PaperProvider');
  return ctx;
}
