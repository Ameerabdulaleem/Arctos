import { describe, expect, it } from 'vitest';
import { csvEscape, isOpenTrade, parseTrades, tradeProfit, tradesToCsv } from './tradebook';

const good = { id: 'a', tokenName: 'BTC', priceBought: '100', amount: '2', priceSold: '150', profitLoss: 100, date: '2026-01-01T00:00:00Z' };

describe('tradebook', () => {
  it('drops malformed stored trades instead of crashing', () => {
    expect(parseTrades(null)).toEqual([]);
    expect(parseTrades('x')).toEqual([]);
    expect(parseTrades([good, null, 5, { ...good, priceBought: 'abc' }, { ...good, date: 'not a date' }, { ...good, id: 7 }])).toEqual([good]);
  });

  it('computes profit and open state', () => {
    expect(tradeProfit('100', '150', '2')).toBe(100);
    expect(tradeProfit('100', '', '2')).toBe(-200);
    expect(tradeProfit('x', '1', '1')).toBe(0);
    expect(isOpenTrade({ priceSold: '0' })).toBe(true);
    expect(isOpenTrade({ priceSold: '' })).toBe(true);
    expect(isOpenTrade({ priceSold: '12' })).toBe(false);
  });

  it('exports CSV that cannot execute formulas', () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvEscape('+1+1')).toBe("'+1+1");
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(tradesToCsv([good]).split('\n')).toHaveLength(2);
  });
});
