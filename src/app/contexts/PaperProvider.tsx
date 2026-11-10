import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PaperContext } from './paper-context';
import {
  availableCash, buy, cancelOrder as cancel, checkExits, markToMarket, matchOrders, newAccount, placeLimit as limit,
  sanitizeAccount, sell, type AssetMeta, type PaperAccount, type PaperFill,
} from '../lib/paperTrading';
import { useTickers } from '../hooks/useTickers';
import { sniperService } from '../services/sniperService';
import { formatPrice } from '../lib/format';

const STORAGE_KEY = 'arctos_paper_v1';

function load(): PaperAccount {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeAccount(JSON.parse(raw)) ?? newAccount();
  } catch {
    /* fall through */
  }
  return newAccount();
}

function announce(fills: PaperFill[]) {
  for (const f of fills) {
    const pnl = f.realizedPnlUsd == null ? '' : ` P/L ${f.realizedPnlUsd >= 0 ? '+' : ''}${formatPrice(f.realizedPnlUsd)}`;
    toast.info(`${f.note}: ${f.side} ${f.symbol}`, { description: `${f.qty.toFixed(6)} at ${formatPrice(f.price)}.${pnl}` });
  }
}

export function PaperProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<PaperAccount>(load);
  const accountRef = useRef(account);
  const { tickers } = useTickers();
  const [dexPrices, setDexPrices] = useState<Record<string, number>>({});

  const commit = useCallback((next: PaperAccount) => {
    accountRef.current = next;
    setAccount(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const prices = useMemo(() => {
    const map: Record<string, number> = { ...dexPrices };
    for (const [base, t] of Object.entries(tickers)) map[base] = t.price;
    return map;
  }, [tickers, dexPrices]);

  // Keep DEX token prices fresh while we hold any.
  const dexIds = useMemo(
    () => Object.values(account.positions).filter((p) => p.source === 'sniper').map((p) => p.key).sort().join(','),
    [account.positions],
  );
  useEffect(() => {
    if (!dexIds) return;
    let cancelled = false;
    const run = async () => {
      if (document.hidden) return;
      try {
        const tokens = await sniperService.refresh(dexIds.split(','));
        if (cancelled) return;
        setDexPrices((prev) => {
          const next = { ...prev };
          for (const t of tokens) next[t.id] = t.priceUsd;
          return next;
        });
      } catch {
        /* keep the last known prices */
      }
    };
    void run();
    const timer = setInterval(run, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dexIds]);

  // Fill resting orders and apply take profit or stop loss whenever prices move.
  useEffect(() => {
    const acc = accountRef.current;
    if (acc.orders.length === 0 && Object.keys(acc.positions).length === 0) return;
    const metaFor = (key: string): AssetMeta => {
      const p = acc.positions[key];
      return p ? { key, symbol: p.symbol, label: p.label, source: p.source } : { key, symbol: key, label: key, source: 'terminal' };
    };
    const now = Date.now();
    const matched = matchOrders(acc, prices, metaFor, now);
    const exited = checkExits(matched.account, prices, now);
    const fills = [...matched.fills, ...exited.fills];
    if (fills.length > 0) {
      commit(exited.account);
      announce(fills);
    }
  }, [prices, commit]);

  const buyMarket = useCallback<NonNullable<import('./paper-context').PaperContextType['buyMarket']>>(
    (meta, qty, price, options) => {
      const result = buy(accountRef.current, meta, qty, price, Date.now(), options);
      if (result.ok) commit(result.account);
      return result;
    },
    [commit],
  );
  const sellMarket = useCallback((key: string, qty: number, price: number) => {
    const result = sell(accountRef.current, key, qty, price, Date.now());
    if (result.ok) commit(result.account);
    return result;
  }, [commit]);
  const placeLimit = useCallback((meta: AssetMeta, side: 'buy' | 'sell', price: number, qty: number) => {
    const result = limit(accountRef.current, meta, side, price, qty, Date.now());
    if (result.ok) {
      commit(result.account);
      return { ok: true as const, order: result.order };
    }
    return result;
  }, [commit]);
  const cancelOrder = useCallback((id: string) => commit(cancel(accountRef.current, id)), [commit]);
  const reset = useCallback(() => commit(newAccount()), [commit]);

  const value = useMemo(() => {
    const m = markToMarket(account, prices);
    return {
      account,
      prices,
      equity: m.equity,
      positionsValue: m.positionsValue,
      totalPnl: m.totalPnl,
      totalPnlPct: m.totalPnlPct,
      positions: m.positions,
      availableCash: availableCash(account),
      buyMarket,
      sellMarket,
      placeLimit,
      cancelOrder,
      reset,
    };
  }, [account, prices, buyMarket, sellMarket, placeLimit, cancelOrder, reset]);

  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>;
}
