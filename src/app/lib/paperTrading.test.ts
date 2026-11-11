import { describe, expect, it } from 'vitest';
import {
  FEE_RATE, availableCash, buy, cancelOrder, checkExits, markToMarket, matchOrders, newAccount, placeLimit,
  sanitizeAccount, sell, type AssetMeta,
} from './paperTrading';

const BTC: AssetMeta = { key: 'BTC', symbol: 'BTC', label: 'Bitcoin', source: 'terminal' };
const meta = () => BTC;

describe('paper trading', () => {
  it('buys with a fee and tracks the average cost including that fee', () => {
    const r = buy(newAccount(10_000), BTC, 0.1, 50_000, 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.account.cash).toBeCloseTo(10_000 - 5000 * (1 + FEE_RATE), 6);
    expect(r.account.positions.BTC.qty).toBeCloseTo(0.1, 12);
    expect(r.account.positions.BTC.avgPrice).toBeCloseTo(50_000 * (1 + FEE_RATE), 6);
  });

  it('rejects orders larger than the cash balance and bad inputs', () => {
    const acc = newAccount(1000);
    expect(buy(acc, BTC, 1, 50_000, 1).ok).toBe(false);
    expect(buy(acc, BTC, 0, 50_000, 1).ok).toBe(false);
    expect(buy(acc, BTC, 1, Number.NaN, 1).ok).toBe(false);
    expect(buy(acc, BTC, -1, 100, 1).ok).toBe(false);
  });

  it('realises profit net of fees when selling', () => {
    const bought = buy(newAccount(10_000), BTC, 0.1, 50_000, 1);
    if (!bought.ok) throw new Error('buy failed');
    const sold = sell(bought.account, 'BTC', 0.1, 60_000, 2);
    if (!sold.ok) throw new Error(sold.error);
    const expected = 0.1 * 60_000 * (1 - FEE_RATE) - 0.1 * 50_000 * (1 + FEE_RATE);
    expect(sold.fill.realizedPnlUsd).toBeCloseTo(expected, 6);
    expect(sold.account.positions.BTC).toBeUndefined();
    expect(sold.account.cash).toBeCloseTo(10_000 + expected, 6);
  });

  it('cannot sell what it does not hold, or more than it holds', () => {
    expect(sell(newAccount(), 'BTC', 1, 100, 1).ok).toBe(false);
    const b = buy(newAccount(), BTC, 0.01, 50_000, 1);
    if (!b.ok) throw new Error('buy failed');
    expect(sell(b.account, 'BTC', 0.02, 50_000, 2).ok).toBe(false);
  });

  it('reserves cash for open buy orders so the account cannot be overspent', () => {
    const acc = newAccount(1000);
    const first = placeLimit(acc, BTC, 'buy', 100, 9, 1);
    if (!first.ok) throw new Error(first.error);
    expect(availableCash(first.account)).toBeLessThan(100);
    expect(placeLimit(first.account, BTC, 'buy', 100, 2, 2).ok).toBe(false);
    expect(availableCash(cancelOrder(first.account, first.order.id))).toBe(1000);
  });

  it('fills limit orders when the live price crosses them, at the better price', () => {
    const placed = placeLimit(newAccount(10_000), BTC, 'buy', 49_000, 0.1, 1);
    if (!placed.ok) throw new Error(placed.error);
    const idle = matchOrders(placed.account, { BTC: 50_000 }, meta, 2);
    expect(idle.fills).toHaveLength(0);
    const hit = matchOrders(placed.account, { BTC: 48_500 }, meta, 3);
    expect(hit.fills).toHaveLength(1);
    expect(hit.fills[0].price).toBe(48_500);
    expect(hit.account.orders).toHaveLength(0);
    expect(hit.account.positions.BTC.qty).toBeCloseTo(0.1, 12);
  });

  it('applies take profit and stop loss from live prices', () => {
    const b = buy(newAccount(10_000), BTC, 0.1, 50_000, 1, { takeProfitPct: 20, stopLossPct: 10 });
    if (!b.ok) throw new Error('buy failed');
    expect(checkExits(b.account, { BTC: 52_000 }, 2).fills).toHaveLength(0);
    const tp = checkExits(b.account, { BTC: 61_000 }, 3);
    expect(tp.fills[0].note).toBe('Take profit hit');
    expect(tp.account.positions.BTC).toBeUndefined();
    const sl = checkExits(b.account, { BTC: 44_000 }, 4);
    expect(sl.fills[0].note).toBe('Stop loss hit');
    expect(sl.fills[0].realizedPnlUsd).toBeLessThan(0);
  });

  it('marks positions to market and falls back to cost when a price is missing', () => {
    const b = buy(newAccount(10_000), BTC, 0.1, 50_000, 1);
    if (!b.ok) throw new Error('buy failed');
    const live = markToMarket(b.account, { BTC: 55_000 });
    expect(live.positions[0].unrealizedPnl).toBeGreaterThan(0);
    expect(live.equity).toBeCloseTo(b.account.cash + 5500, 6);
    const stale = markToMarket(b.account, {});
    expect(stale.positions[0].price).toBeNull();
    expect(stale.positions[0].unrealizedPnl).toBeNull();
  });

  it('rebuilds stored accounts safely and rejects tampered ones', () => {
    const good = newAccount();
    expect(sanitizeAccount(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(sanitizeAccount(null)).toBeNull();
    expect(sanitizeAccount({ ...good, cash: -5 })).toBeNull();
    expect(sanitizeAccount({ ...good, cash: 'lots' })).toBeNull();
    expect(sanitizeAccount({ ...good, version: 2 })).toBeNull();
    const withJunk = sanitizeAccount({ ...good, positions: { x: { key: 'x', qty: -1 }, y: 5 }, orders: [null, 3], fills: 'nope' });
    expect(withJunk?.positions).toEqual({});
    expect(withJunk?.orders).toEqual([]);
    expect(withJunk?.fills).toEqual([]);
  });
});
