import { describe, expect, it } from 'vitest';
import {
  FEE_RATE, availableCash, bookKeeperSales, buy, cancelOrder, checkExits, markToMarket, matchOrders, newAccount, placeLimit,
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

  describe('trade keeper', () => {
    const TOKEN: AssetMeta = { key: 'solana:mint', symbol: 'MEME', label: 'Meme', source: 'sniper' };
    const sniped = () => {
      const r = buy(newAccount(10_000), TOKEN, 1000, 1, 1, { devHoldingPct: 8 });
      if (!r.ok) throw new Error(r.error);
      return r.account;
    };
    const sale = (id: string, qty: number, priceUsd: number, note = 'Take profit 1 hit') => ({ id, key: TOKEN.key, note, qty, priceUsd, at: 50 });

    it('leaves sniper trades to the keeper', () => {
      const r = buy(newAccount(10_000), TOKEN, 1000, 1, 1, { takeProfitPct: 10, stopLossPct: 10 });
      if (!r.ok) throw new Error(r.error);
      expect(checkExits(r.account, { [TOKEN.key]: 5 }, 2).fills).toHaveLength(0);
      expect(checkExits(r.account, { [TOKEN.key]: 0.1 }, 2).fills).toHaveLength(0);
      // The developer's share at the time of the buy is kept for the exit guard.
      expect(sniped().positions[TOKEN.key].devHoldingPct).toBe(8);
    });

    it('books a part sale at the keeper\'s price and keeps the rest', () => {
      const acc = sniped();
      const state = { key: TOKEN.key, tpDone: [1], guard: {}, qty: 400 };
      const r = bookKeeperSales(acc, [sale('aa', 600, 1.9)], [state]);
      expect(r.fills).toHaveLength(1);
      expect(r.fills[0]).toMatchObject({ side: 'sell', qty: 600, price: 1.9, time: 50, note: 'Take profit 1 hit' });
      expect(r.fills[0].realizedPnlUsd).toBeGreaterThan(0);
      expect(r.account.positions[TOKEN.key].qty).toBeCloseTo(400, 9);
      expect(r.account.positions[TOKEN.key].keeper).toEqual(state);
      expect(r.account.cash).toBeCloseTo(acc.cash + 600 * 1.9 * (1 - FEE_RATE), 6);
      expect(r.booked).toEqual(['aa']);
    });

    it('never books the same sale twice, however often it is offered', () => {
      const first = bookKeeperSales(sniped(), [sale('aa', 600, 1.9)], []);
      const again = bookKeeperSales(first.account, [sale('aa', 600, 1.9)], []);
      expect(again.fills).toHaveLength(0);
      expect(again.account).toBe(first.account);
      // It is still reported back, so the keeper stops offering it.
      expect(again.booked).toEqual(['aa']);
      // The record of booked sales survives a reload.
      const reloaded = sanitizeAccount(JSON.parse(JSON.stringify(first.account)));
      expect(bookKeeperSales(reloaded!, [sale('aa', 600, 1.9)], []).fills).toHaveLength(0);
    });

    it('books several sales in order and closes the position on the last', () => {
      const r = bookKeeperSales(sniped(), [sale('aa', 600, 2), sale('bb', 200, 5, 'Take profit 2 hit'), sale('cc', 200, 11, 'Take profit 3 hit')], [{ key: TOKEN.key }]);
      expect(r.fills.map((f) => f.note)).toEqual(['Take profit 1 hit', 'Take profit 2 hit', 'Take profit 3 hit']);
      expect(r.account.positions[TOKEN.key]).toBeUndefined();
      expect(r.account.fills[0].note).toBe('Take profit 3 hit');
    });

    it('sells no more than is held, and nothing once the position is gone', () => {
      const partly = sell(sniped(), TOKEN.key, 900, 1.2, 10);
      if (!partly.ok) throw new Error(partly.error);
      const r = bookKeeperSales(partly.account, [sale('aa', 600, 1.9)], []);
      expect(r.fills[0].qty).toBeCloseTo(100, 9);
      expect(r.account.positions[TOKEN.key]).toBeUndefined();
      const late = bookKeeperSales(r.account, [sale('bb', 200, 5)], [{ key: TOKEN.key }]);
      expect(late.fills).toHaveLength(0);
      expect(late.booked).toEqual(['bb']);
      expect(late.account.cash).toBe(r.account.cash);
    });

    it('does not touch a terminal position that happens to share a key', () => {
      const b = buy(newAccount(10_000), BTC, 0.1, 50_000, 1);
      if (!b.ok) throw new Error(b.error);
      const r = bookKeeperSales(b.account, [{ id: 'aa', key: 'BTC', note: 'Stop loss hit', qty: 0.1, priceUsd: 1, at: 5 }], [{ key: 'BTC' }]);
      expect(r.fills).toHaveLength(0);
      expect(r.account.positions.BTC.qty).toBeCloseTo(0.1, 12);
      expect(r.account.positions.BTC.keeper).toBeUndefined();
    });

    it('drops a stored keeper state that is not for its own position', () => {
      const acc = bookKeeperSales(sniped(), [], [{ key: TOKEN.key }]).account;
      const raw = JSON.parse(JSON.stringify(acc));
      expect(sanitizeAccount(raw)?.positions[TOKEN.key].keeper).toEqual({ key: TOKEN.key });
      raw.positions[TOKEN.key].keeper = { key: 'solana:other' };
      expect(sanitizeAccount(raw)?.positions[TOKEN.key].keeper).toBeUndefined();
      raw.positions[TOKEN.key].keeper = { key: TOKEN.key, junk: 'x'.repeat(10_000) };
      expect(sanitizeAccount(raw)?.positions[TOKEN.key].keeper).toBeUndefined();
      raw.positions[TOKEN.key].keeper = ['not', 'an', 'object'];
      expect(sanitizeAccount(raw)?.positions[TOKEN.key].keeper).toBeUndefined();
    });
  });
});
