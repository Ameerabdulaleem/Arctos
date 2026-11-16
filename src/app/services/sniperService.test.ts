import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, judge, snipeRecord, type FeedToken } from './sniperService';

function token(overrides: Partial<FeedToken> = {}): FeedToken {
  return {
    id: 'solana:mint', symbol: 'TEST', name: 'Test', address: 'mint', chain: 'solana', pairAddress: 'pool', dex: 'pumpswap',
    priceUsd: 0.001, liquidityUsd: 40_000, marketCapUsd: 300_000, volume24hUsd: 90_000, change5m: 1, change1h: 12, change24h: 40,
    buys24h: 900, sells24h: 500, createdAt: Date.now() - 3_600_000, url: 'https://www.geckoterminal.com/solana/pools/pool', imageUrl: null,
    launchpad: 'PumpSwap', onCurve: false, graduation: { percent: 100, completed: true },
    flow1h: { buys: 300, sells: 100, buyers: 200, sellers: 80 }, flow24h: { buys: 900, sells: 500, buyers: 600, sellers: 300 },
    buyRatioPct: 75, holders: 900, top10Pct: 25,
    developer: { address: 'dev', holdingPct: 3, verdict: 'proven', record: { launchesSeen: 5, successes: 4, successRate: 80, avgBuyRatio: 62 } },
    security: { available: true, riskScore: 5, riskLevel: 'low', flags: [], buyTaxPct: 0, sellTaxPct: 0, holders: 900, isHoneypot: false, source: 'GoPlus' },
    score: { total: 86, grade: 'A', parts: { demand: 26, developer: 21, safety: 23, liquidity: 8, momentum: 8 }, reasons: [], warnings: [], blocked: false, checked: true },
    ...overrides,
  };
}

describe('judge', () => {
  it('accepts a well rated, fully checked token', () => {
    expect(judge(token(), DEFAULT_FILTERS, true)).toEqual({ ok: true, reasons: [] });
  });

  it('never accepts a token that has not been checked or is blocked', () => {
    const unchecked = token({ score: { ...token().score, checked: false } });
    expect(judge(unchecked, DEFAULT_FILTERS, true).reasons).toContain('Still being checked');
    const blocked = token({ score: { ...token().score, blocked: true, warnings: ['Flagged as a honeypot: it may be impossible to sell'] } });
    expect(judge(blocked, DEFAULT_FILTERS, true).ok).toBe(false);
  });

  it('treats unknown demand and missing risk data as reasons to stay out', () => {
    expect(judge(token({ buyRatioPct: null }), DEFAULT_FILTERS, true).reasons).toContain('Too few trades to read demand');
    expect(judge(token({ security: null }), DEFAULT_FILTERS, true).reasons).toContain('No contract risk data available');
    // On a chain with no risk provider the missing report is expected, so the other checks decide.
    expect(judge(token({ security: null }), DEFAULT_FILTERS, false).ok).toBe(true);
  });

  it('applies the score, buy share, developer and tax limits', () => {
    expect(judge(token({ score: { ...token().score, total: 60 } }), DEFAULT_FILTERS, true).ok).toBe(false);
    expect(judge(token({ buyRatioPct: 41 }), DEFAULT_FILTERS, true).ok).toBe(false);
    expect(judge(token({ developer: { ...token().developer!, holdingPct: 20 } }), DEFAULT_FILTERS, true).ok).toBe(false);
    expect(judge(token({ security: { ...token().security!, sellTaxPct: 30 } }), DEFAULT_FILTERS, true).ok).toBe(false);
  });

  it('can require a proven developer', () => {
    const strict = { ...DEFAULT_FILTERS, minDevSuccessPct: 60 };
    expect(judge(token(), strict, true).ok).toBe(true);
    const noRecord = token({ developer: { address: 'dev', holdingPct: 3, verdict: 'first', record: { launchesSeen: 0, successes: 0, successRate: null, avgBuyRatio: null } } });
    expect(judge(noRecord, strict, true).reasons).toContain('Developer has no track record yet');
    expect(judge(noRecord, DEFAULT_FILTERS, true).ok).toBe(true);
  });

  it('does not hold a bonding curve token to the pool liquidity minimum', () => {
    const curve = token({ onCurve: true, liquidityUsd: 0, graduation: { percent: 80, completed: false } });
    expect(judge(curve, DEFAULT_FILTERS, true).ok).toBe(true);
    expect(judge(token({ liquidityUsd: 500 }), DEFAULT_FILTERS, true).reasons).toContain('Liquidity is below your minimum');
  });
});

describe('snipeRecord', () => {
  it('measures the win rate from closed snipes only', () => {
    const fills = [
      { key: 'solana:a', side: 'buy' },
      { key: 'solana:a', side: 'sell', realizedPnlUsd: 40 },
      { key: 'bsc:0xb', side: 'sell', realizedPnlUsd: -15 },
      { key: 'solana:c', side: 'sell', realizedPnlUsd: 5 },
      { key: 'BTC', side: 'sell', realizedPnlUsd: 900 }, // a terminal trade, not a snipe
    ];
    const r = snipeRecord(fills);
    expect(r.closed).toBe(3);
    expect(r.wins).toBe(2);
    expect(r.winRatePct).toBeCloseTo(66.67, 1);
    expect(r.realizedUsd).toBe(30);
  });

  it('reports no win rate before anything has closed', () => {
    expect(snipeRecord([{ key: 'solana:a', side: 'buy' }]).winRatePct).toBeNull();
  });
});
