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
  buyMarket: (meta: AssetMeta, qty: number, price: number, options?: { takeProfitPct?: number; stopLossPct?: number; note?: string }) => TradeResult;
  sellMarket: (key: string, qty: number, price: number) => TradeResult;
  placeLimit: (meta: AssetMeta, side: 'buy' | 'sell', price: number, qty: number) => { ok: true; order: PaperOrder } | { ok: false; error: string };
  cancelOrder: (id: string) => void;
  reset: () => void;
}

export const PaperContext = createContext<PaperContextType | undefined>(undefined);

export function usePaper(): PaperContextType {
  const ctx = useContext(PaperContext);
  if (!ctx) throw new Error('usePaper must be used within a PaperProvider');
  return ctx;
}
