// Paper trading engine. Pure functions, no network and no storage side effects, so it is easy
// to test. Orders are filled against live prices supplied by the caller.

export const FEE_RATE = 0.001; // 0.1 percent per fill, similar to a spot taker fee
export const STARTING_BALANCE = 10_000;
const EPS = 1e-9;

export interface PaperPosition {
  key: string;
  symbol: string;
  label: string;
  qty: number;
  /** Average cost per unit including the buy fee */
  avgPrice: number;
  openedAt: number;
  source: 'terminal' | 'sniper';
  takeProfitPct?: number;
  stopLossPct?: number;
}

export interface PaperOrder {
  id: string;
  key: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  createdAt: number;
}

export interface PaperFill {
  id: string;
  key: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  feeUsd: number;
  time: number;
  realizedPnlUsd: number | null;
  note: string;
}

export interface PaperAccount {
  version: 1;
  startingBalance: number;
  cash: number;
  realizedPnl: number;
  positions: Record<string, PaperPosition>;
  orders: PaperOrder[];
  fills: PaperFill[];
}

export interface AssetMeta {
  key: string;
  symbol: string;
  label: string;
  source: 'terminal' | 'sniper';
}

export type TradeResult = { ok: true; account: PaperAccount; fill: PaperFill } | { ok: false; error: string };

let counter = 0;
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  counter += 1;
  return `p-${Date.now().toString(36)}-${counter}`;
}

export function newAccount(startingBalance = STARTING_BALANCE): PaperAccount {
  return { version: 1, startingBalance, cash: startingBalance, realizedPnl: 0, positions: {}, orders: [], fills: [] };
}

function cap<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(0, max) : list;
}

export function reservedCash(account: PaperAccount): number {
  return account.orders.filter((o) => o.side === 'buy').reduce((s, o) => s + o.qty * o.price * (1 + FEE_RATE), 0);
}

export function reservedQty(account: PaperAccount, key: string): number {
  return account.orders.filter((o) => o.side === 'sell' && o.key === key).reduce((s, o) => s + o.qty, 0);
}

export function availableCash(account: PaperAccount): number {
  return Math.max(0, account.cash - reservedCash(account));
}

function validQtyPrice(qty: number, price: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return 'Enter a quantity greater than zero.';
  if (!Number.isFinite(price) || price <= 0) return 'No live price is available right now.';
  return null;
}

export function buy(
  account: PaperAccount,
  meta: AssetMeta,
  qty: number,
  price: number,
  now: number,
  options: { takeProfitPct?: number; stopLossPct?: number; note?: string } = {},
): TradeResult {
  const invalid = validQtyPrice(qty, price);
  if (invalid) return { ok: false, error: invalid };
  const cost = qty * price;
  const fee = cost * FEE_RATE;
  if (cost + fee > availableCash(account) + EPS) {
    return { ok: false, error: 'Not enough paper cash for this order.' };
  }
  const existing = account.positions[meta.key];
  const newQty = (existing?.qty ?? 0) + qty;
  const totalCost = (existing ? existing.avgPrice * existing.qty : 0) + cost + fee;
  const position: PaperPosition = {
    key: meta.key,
    symbol: meta.symbol,
    label: meta.label,
    source: meta.source,
    qty: newQty,
    avgPrice: totalCost / newQty,
    openedAt: existing?.openedAt ?? now,
    takeProfitPct: options.takeProfitPct ?? existing?.takeProfitPct,
    stopLossPct: options.stopLossPct ?? existing?.stopLossPct,
  };
  const fill: PaperFill = {
    id: newId(), key: meta.key, symbol: meta.symbol, side: 'buy', qty, price, feeUsd: fee, time: now,
    realizedPnlUsd: null, note: options.note ?? 'Market buy',
  };
  return {
    ok: true,
    fill,
    account: {
      ...account,
      cash: account.cash - cost - fee,
      positions: { ...account.positions, [meta.key]: position },
      fills: cap([fill, ...account.fills], 300),
    },
  };
}

export function sell(account: PaperAccount, key: string, qty: number, price: number, now: number, note = 'Market sell'): TradeResult {
  const invalid = validQtyPrice(qty, price);
  if (invalid) return { ok: false, error: invalid };
  const position = account.positions[key];
  if (!position) return { ok: false, error: 'You do not hold this asset.' };
  const free = position.qty - reservedQty(account, key);
  if (qty > free * (1 + EPS) + EPS) return { ok: false, error: 'Not enough free balance to sell that amount.' };
  const sellQty = Math.min(qty, position.qty);
  const proceeds = sellQty * price;
  const fee = proceeds * FEE_RATE;
  const realized = proceeds - fee - position.avgPrice * sellQty;
  const remaining = position.qty - sellQty;
  const positions = { ...account.positions };
  if (remaining <= position.qty * 1e-9) delete positions[key];
  else positions[key] = { ...position, qty: remaining };
  const fill: PaperFill = {
    id: newId(), key, symbol: position.symbol, side: 'sell', qty: sellQty, price, feeUsd: fee, time: now,
    realizedPnlUsd: realized, note,
  };
  return {
    ok: true,
    fill,
    account: {
      ...account,
      cash: account.cash + proceeds - fee,
      realizedPnl: account.realizedPnl + realized,
      positions,
      fills: cap([fill, ...account.fills], 300),
    },
  };
}

export function placeLimit(account: PaperAccount, meta: AssetMeta, side: 'buy' | 'sell', price: number, qty: number, now: number):
  { ok: true; account: PaperAccount; order: PaperOrder } | { ok: false; error: string } {
  const invalid = validQtyPrice(qty, price);
  if (invalid) return { ok: false, error: invalid };
  if (account.orders.length >= 25) return { ok: false, error: 'You have too many open orders.' };
  if (side === 'buy' && qty * price * (1 + FEE_RATE) > availableCash(account) + EPS) {
    return { ok: false, error: 'Not enough paper cash for this order.' };
  }
  if (side === 'sell') {
    const held = account.positions[meta.key]?.qty ?? 0;
    if (qty > held - reservedQty(account, meta.key) + EPS) return { ok: false, error: 'Not enough free balance for this sell order.' };
  }
  const order: PaperOrder = { id: newId(), key: meta.key, symbol: meta.symbol, side, price, qty, createdAt: now };
  return { ok: true, order, account: { ...account, orders: [order, ...account.orders] } };
}

export function cancelOrder(account: PaperAccount, id: string): PaperAccount {
  return { ...account, orders: account.orders.filter((o) => o.id !== id) };
}

/** Fills resting limit orders whose price has been reached by the latest live price. */
export function matchOrders(account: PaperAccount, prices: Record<string, number>, meta: (key: string) => AssetMeta, now: number):
  { account: PaperAccount; fills: PaperFill[] } {
  let acc = account;
  const fills: PaperFill[] = [];
  for (const order of [...account.orders].reverse()) {
    const last = prices[order.key];
    if (!last || !Number.isFinite(last)) continue;
    const crossed = order.side === 'buy' ? last <= order.price : last >= order.price;
    if (!crossed) continue;
    // Take the order off the book first so its reserved cash is released before the fill is checked.
    const without = { ...acc, orders: acc.orders.filter((o) => o.id !== order.id) };
    const fillPrice = order.side === 'buy' ? Math.min(order.price, last) : Math.max(order.price, last);
    const result = order.side === 'buy'
      ? buy(without, meta(order.key), order.qty, fillPrice, now, { note: 'Limit buy filled' })
      : sell(without, order.key, order.qty, fillPrice, now, 'Limit sell filled');
    if (result.ok) {
      acc = result.account;
      fills.push(result.fill);
    } else {
      acc = without; // the order can no longer be honoured, so drop it
    }
  }
  return { account: acc, fills };
}

/** Closes positions that reached their take profit or stop loss. */
export function checkExits(account: PaperAccount, prices: Record<string, number>, now: number): { account: PaperAccount; fills: PaperFill[] } {
  let acc = account;
  const fills: PaperFill[] = [];
  for (const position of Object.values(account.positions)) {
    const price = prices[position.key];
    if (!price || !Number.isFinite(price) || position.avgPrice <= 0) continue;
    const changePct = (price / position.avgPrice - 1) * 100;
    let note: string | null = null;
    if (position.takeProfitPct && changePct >= position.takeProfitPct) note = 'Take profit hit';
    else if (position.stopLossPct && changePct <= -position.stopLossPct) note = 'Stop loss hit';
    if (!note) continue;
    const current = acc.positions[position.key];
    if (!current) continue;
    const result = sell({ ...acc, orders: acc.orders.filter((o) => o.key !== position.key) }, position.key, current.qty, price, now, note);
    if (result.ok) {
      acc = result.account;
      fills.push(result.fill);
    }
  }
  return { account: acc, fills };
}

export interface MarkedPosition extends PaperPosition {
  price: number | null;
  value: number;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
}

export function markToMarket(account: PaperAccount, prices: Record<string, number>) {
  const positions: MarkedPosition[] = Object.values(account.positions).map((p) => {
    const price = prices[p.key];
    const hasPrice = Number.isFinite(price) && price > 0;
    return {
      ...p,
      price: hasPrice ? price : null,
      value: hasPrice ? p.qty * price : p.qty * p.avgPrice,
      unrealizedPnl: hasPrice ? (price - p.avgPrice) * p.qty : null,
      unrealizedPct: hasPrice ? (price / p.avgPrice - 1) * 100 : null,
    };
  });
  const positionsValue = positions.reduce((s, p) => s + p.value, 0);
  const equity = account.cash + positionsValue;
  return {
    positions,
    equity,
    positionsValue,
    totalPnl: equity - account.startingBalance,
    totalPnlPct: ((equity - account.startingBalance) / account.startingBalance) * 100,
  };
}

// ── Persistence helpers ──────────────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/** Rebuilds an account from untrusted stored JSON, or returns null when it is unusable. */
export function sanitizeAccount(raw: unknown): PaperAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const startingBalance = num(r.startingBalance);
  const cash = num(r.cash);
  const realizedPnl = num(r.realizedPnl);
  if (r.version !== 1 || startingBalance === null || startingBalance <= 0 || cash === null || cash < 0 || realizedPnl === null) return null;

  const positions: Record<string, PaperPosition> = {};
  for (const p of Object.values((r.positions && typeof r.positions === 'object' ? r.positions : {}) as Record<string, unknown>)) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const key = str(o.key, 120), symbol = str(o.symbol, 24), label = str(o.label, 80);
    const qty = num(o.qty), avgPrice = num(o.avgPrice), openedAt = num(o.openedAt);
    if (!key || !symbol || !label || qty === null || qty <= 0 || avgPrice === null || avgPrice <= 0 || openedAt === null) continue;
    positions[key] = {
      key, symbol, label, qty, avgPrice, openedAt,
      source: o.source === 'sniper' ? 'sniper' : 'terminal',
      takeProfitPct: num(o.takeProfitPct) ?? undefined,
      stopLossPct: num(o.stopLossPct) ?? undefined,
    };
  }
  const orders: PaperOrder[] = [];
  for (const x of Array.isArray(r.orders) ? r.orders : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = str(o.id), key = str(o.key, 120), symbol = str(o.symbol, 24);
    const price = num(o.price), qty = num(o.qty), createdAt = num(o.createdAt);
    if (!id || !key || !symbol || price === null || price <= 0 || qty === null || qty <= 0 || createdAt === null) continue;
    orders.push({ id, key, symbol, side: o.side === 'sell' ? 'sell' : 'buy', price, qty, createdAt });
  }
  const fills: PaperFill[] = [];
  for (const x of Array.isArray(r.fills) ? r.fills.slice(0, 300) : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = str(o.id), key = str(o.key, 120), symbol = str(o.symbol, 24);
    const qty = num(o.qty), price = num(o.price), feeUsd = num(o.feeUsd), time = num(o.time);
    if (!id || !key || !symbol || qty === null || price === null || feeUsd === null || time === null) continue;
    fills.push({ id, key, symbol, side: o.side === 'sell' ? 'sell' : 'buy', qty, price, feeUsd, time, realizedPnlUsd: num(o.realizedPnlUsd), note: str(o.note, 60) ?? '' });
  }
  return { version: 1, startingBalance, cash, realizedPnl, positions, orders: orders.slice(0, 25), fills };
}
