import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PaperContext, type KeeperStatus, type PaperContextType } from './paper-context';
import {
  availableCash, bookKeeperSales, buy, cancelOrder as cancel, checkExits, markToMarket, matchOrders, newAccount, placeLimit as limit,
  sanitizeAccount, sell, type AssetMeta, type PaperAccount, type PaperFill,
} from '../lib/paperTrading';
import { EXIT_CHANGED_EVENT, loadExit, toPlan } from '../lib/exitPlan';
import { useTickers } from '../hooks/useTickers';
import { errorMessage } from '../services/api';
import { hasDeviceKey, keeperService, keeperStateOf, type KeeperSale } from '../services/keeperService';
import { sniperService } from '../services/sniperService';
import { formatPrice } from '../lib/format';

const STORAGE_KEY = 'arctos_paper_v1';
/** How often open sniper trades are checked while the app is open. */
const KEEPER_INTERVAL_MS = 12_000;
const KEEPER_LOCK = 'arctos-keeper';

function load(): PaperAccount {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeAccount(JSON.parse(raw)) ?? newAccount();
  } catch {
    /* fall through */
  }
  return newAccount();
}

function pnlText(f: PaperFill): string {
  return f.realizedPnlUsd == null ? '' : ` P/L ${f.realizedPnlUsd >= 0 ? '+' : ''}${formatPrice(f.realizedPnlUsd)}`;
}

function announce(fills: PaperFill[]) {
  for (const f of fills) {
    toast.info(`${f.note}: ${f.side} ${f.symbol}`, { description: `${f.qty.toFixed(6)} at ${formatPrice(f.price)}.${pnlText(f)}` });
  }
}

/**
 * Sales the trade keeper made, with its reason. A sale dated before the keeper's answer was
 * made by a background check, with the app closed, and is announced as such.
 */
function announceKeeper(fills: PaperFill[], sales: KeeperSale[], answeredAt: number) {
  const reasons = new Map(sales.map((s) => [`${s.key}|${s.at}|${s.note}`, s.detail]));
  for (const f of fills) {
    const away = f.time < answeredAt;
    const detail = reasons.get(`${f.key}|${f.time}|${f.note}`) ?? '';
    toast.info(`${f.note}: sold ${f.symbol}${away ? ' while you were away' : ''}`, {
      description: `${detail} Sold at ${formatPrice(f.price)}.${pnlText(f)}`.trim(),
      duration: away ? 12_000 : 7000,
    });
  }
}

/** Last prices the keeper saw, so open snipes show a value before the first answer arrives. */
function keeperPrices(account: PaperAccount): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of Object.values(account.positions)) {
    const price = keeperStateOf(p)?.last?.priceUsd;
    if (typeof price === 'number' && price > 0) out[p.key] = price;
  }
  return out;
}

export function PaperProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<PaperAccount>(load);
  const accountRef = useRef(account);
  const { tickers } = useTickers();
  const [dexPrices, setDexPrices] = useState<Record<string, number>>(() => keeperPrices(account));
  const [keeper, setKeeper] = useState<KeeperStatus>({ mode: null, durable: false, lastBackgroundCheck: null, syncedAt: null, error: null, rejected: {} });
  const pendingAck = useRef<string[]>([]);
  const syncing = useRef(false);
  // Whether the keeper may hold trades this browser no longer lists. It has to be told about a
  // snipe that was sold by hand, or it would go on managing a position that is gone.
  const keeperMayHold = useRef(hasDeviceKey());

  const commit = useCallback((next: PaperAccount) => {
    accountRef.current = next;
    setAccount(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Another tab changed the account: follow it, so two tabs never trade against different books.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue == null) return;
      try {
        const next = sanitizeAccount(JSON.parse(event.newValue));
        if (next) {
          accountRef.current = next;
          setAccount(next);
        }
      } catch {
        /* ignore a half written value */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const prices = useMemo(() => {
    const map: Record<string, number> = { ...dexPrices };
    for (const [base, t] of Object.entries(tickers)) map[base] = t.price;
    return map;
  }, [tickers, dexPrices]);

  // One round with the trade keeper: report the open snipes, book the sales it decided on.
  const keeperRound = useCallback(async () => {
    if (syncing.current) return;
    const held = Object.values(accountRef.current.positions).filter((p) => p.source === 'sniper');
    if (held.length === 0 && pendingAck.current.length === 0 && !keeperMayHold.current) return;
    syncing.current = true;
    let followUp = false;
    try {
      const plan = toPlan(loadExit());
      const sentAck = pendingAck.current;
      const response = await keeperService.sync(
        held.map((p) => ({
          key: p.key, symbol: p.symbol, qty: p.qty, entryPrice: p.avgPrice, plan,
          devHoldingPct: p.devHoldingPct, openedAt: p.openedAt, state: p.keeper,
        })),
        sentAck,
      );
      // The account may have changed while the request was in flight, so book against the latest.
      const result = bookKeeperSales(accountRef.current, response.executions, response.positions);
      if (result.account !== accountRef.current) commit(result.account);
      pendingAck.current = result.booked;
      followUp = result.booked.length > 0;
      keeperMayHold.current = response.mode === 'offline' && (response.positions.length > 0 || response.executions.length > 0);
      announceKeeper(result.fills, response.executions, response.checkedAt);
      setDexPrices((prev) => {
        const next = { ...prev };
        for (const p of response.positions) if (p.last && p.last.priceUsd > 0) next[p.key] = p.last.priceUsd;
        return next;
      });
      setKeeper({
        mode: response.mode, durable: response.durable, lastBackgroundCheck: response.lastBackgroundCheck, syncedAt: Date.now(), error: null,
        rejected: Object.fromEntries((response.rejected ?? []).map((r) => [r.key, r.reason])),
      });
    } catch (error) {
      setKeeper((prev) => ({ ...prev, error: errorMessage(error, 'The trade keeper could not be reached.') }));
    } finally {
      syncing.current = false;
    }
    // Tell the keeper straight away that its sales are booked, so it stops offering them.
    // After a failed round the regular interval tries again instead.
    if (followUp) setTimeout(() => void keeperRound(), 600);
  }, [commit]);

  // With several tabs open only one of them talks to the keeper at a time.
  const syncKeeper = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      void navigator.locks.request(KEEPER_LOCK, { ifAvailable: true }, async (lock) => {
        if (lock) await keeperRound();
      });
    } else {
      void keeperRound();
    }
  }, [keeperRound]);

  // Keep going while the tab is in the background: when nothing else holds the trades,
  // this page is what manages them.
  const sniperKeys = useMemo(
    () => Object.values(account.positions).filter((p) => p.source === 'sniper').map((p) => p.key).sort().join(','),
    [account.positions],
  );
  useEffect(() => {
    syncKeeper();
    const timer = setInterval(syncKeeper, KEEPER_INTERVAL_MS);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onPlanChange = () => {
      clearTimeout(debounce);
      debounce = setTimeout(syncKeeper, 900);
    };
    window.addEventListener(EXIT_CHANGED_EVENT, onPlanChange);
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      window.removeEventListener(EXIT_CHANGED_EVENT, onPlanChange);
    };
    // A new or closed snipe is reported at once.
  }, [syncKeeper, sniperKeys]);

  // If the keeper cannot be reached, still show live prices for held tokens.
  const keeperDown = keeper.error !== null;
  useEffect(() => {
    if (!sniperKeys || !keeperDown) return;
    let cancelled = false;
    const run = async () => {
      try {
        const tokens = await sniperService.refresh(sniperKeys.split(','));
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
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sniperKeys, keeperDown]);

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

  const buyMarket = useCallback<PaperContextType['buyMarket']>(
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
      keeper,
      syncKeeper,
    };
  }, [account, prices, buyMarket, sellMarket, placeLimit, cancelOrder, reset, keeper, syncKeeper]);

  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>;
}
