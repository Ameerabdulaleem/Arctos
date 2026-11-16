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
  // Fills are stored newest first, as the paper account keeps them.
  const buy = (key: string, qty: number, time: number) => ({ key, side: 'buy', qty, time });
  const sell = (key: string, qty: number, time: number, realizedPnlUsd: number) => ({ key, side: 'sell', qty, time, realizedPnlUsd });

  it('measures the win rate from snipes that were sold out', () => {
    const fills = [
      sell('BTC', 1, 9, 900), // a terminal trade, not a snipe
      sell('solana:c', 10, 8, 5),
      buy('solana:c', 10, 7),
      sell('bsc:0xb', 10, 6, -15),
      buy('bsc:0xb', 10, 5),
      sell('solana:a', 10, 2, 40),
      buy('solana:a', 10, 1),
    ];
    const r = snipeRecord(fills);
    expect(r.closed).toBe(3);
    expect(r.wins).toBe(2);
    expect(r.winRatePct).toBeCloseTo(66.67, 1);
    expect(r.realizedUsd).toBe(30);
  });

  it('counts a snipe sold in steps as one trade', () => {
    const fills = [
      sell('solana:a', 200, 4, 300), // take profit 3
      sell('solana:a', 200, 3, 120), // take profit 2
      sell('solana:a', 600, 2, 80), // take profit 1
      buy('solana:a', 1000, 1),
    ];
    expect(snipeRecord(fills)).toEqual({ closed: 1, wins: 1, winRatePct: 100, realizedUsd: 500 });
  });

  it('books part sales as profit without calling the snipe closed', () => {
    const open = snipeRecord([sell('solana:a', 600, 2, 80), buy('solana:a', 1000, 1)]);
    expect(open).toEqual({ closed: 0, wins: 0, winRatePct: null, realizedUsd: 80 });
    // A take profit followed by a stop loss on the rest is one trade, judged on the total.
    const mixed = snipeRecord([sell('solana:a', 400, 3, -90), sell('solana:a', 600, 2, 80), buy('solana:a', 1000, 1)]);
    expect(mixed).toEqual({ closed: 1, wins: 0, winRatePct: 0, realizedUsd: -10 });
  });

  it('treats a token bought again as a new trade', () => {
    const fills = [sell('solana:a', 5, 4, -3), buy('solana:a', 5, 3), sell('solana:a', 10, 2, 40), buy('solana:a', 10, 1)];
    expect(snipeRecord(fills)).toMatchObject({ closed: 2, wins: 1, winRatePct: 50 });
  });

  it('reports no win rate before anything has closed', () => {
    expect(snipeRecord([buy('solana:a', 1, 1)]).winRatePct).toBeNull();
  });
});
