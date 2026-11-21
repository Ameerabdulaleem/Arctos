import { describe, expect, it } from 'vitest';
import type { Security, SniperToken } from '../services/sniperService';
import { chaseCheck, SMART_MIN_POINTS, smartVerdict } from './smartSnipe';

const NOW = 1_800_000_000_000;
const clean: Security = { available: true, riskScore: 5, riskLevel: 'low', flags: [], buyTaxPct: 0, sellTaxPct: 0, holders: 2000, isHoneypot: false, source: 'GoPlus' };

function token(over: Partial<SniperToken> = {}): SniperToken {
  return {
    id: 'solana:x', symbol: 'X', name: 'X', address: 'x', chain: 'solana', pairAddress: 'p', dex: 'raydium',
    priceUsd: 0.01, liquidityUsd: 150_000, marketCapUsd: 1_500_000, volume24hUsd: 600_000,
    change5m: 2, change1h: 14, change24h: 40, buys24h: 1400, sells24h: 900, createdAt: NOW - 6 * 3600_000, url: '', imageUrl: null, ...over,
  };
}

describe('anti chase', () => {
  it('flags spikes and dumps, and lets steady climbs through', () => {
    expect(chaseCheck({ change5m: 25, change1h: 30, change24h: 50 }).chasing).toBe(true);
    expect(chaseCheck({ change5m: 3, change1h: 85, change24h: 90 }).chasing).toBe(true);
    expect(chaseCheck({ change5m: 1, change1h: 5, change24h: 650 }).chasing).toBe(true);
    expect(chaseCheck({ change5m: -9, change1h: -2, change24h: 10 }).dumping).toBe(true);
    expect(chaseCheck({ change5m: 2, change1h: 14, change24h: 40 })).toEqual({ chasing: false, dumping: false, note: null });
  });
});

describe('automatic filter', () => {
  it('buys a liquid token with buyers in control and a steady climb', () => {
    const v = smartVerdict(token(), clean, { now: NOW, trending: true });
    expect(v.ok).toBe(true);
    expect(v.points).toBeGreaterThanOrEqual(SMART_MIN_POINTS);
    expect(v.good.join(' ')).toMatch(/buys/);
  });

  it('refuses a token that already pumped hard', () => {
    const v = smartVerdict(token({ change1h: 120, change5m: 30 }), clean, { now: NOW });
    expect(v.ok).toBe(false);
    expect(v.reasons[0]).toMatch(/spike|Late buyers/);
  });

  it('refuses thin, unchecked, risky, young or sold off tokens', () => {
    expect(smartVerdict(token({ liquidityUsd: 8000 }), clean, { now: NOW }).reasons.join()).toMatch(/Liquidity under/);
    expect(smartVerdict(token({ liquidityUsd: 40_000, marketCapUsd: 400_000 }), null, { now: NOW }).reasons.join()).toMatch(/not checked/);
    expect(smartVerdict(token({ createdAt: NOW - 3600_000 }), null, { now: NOW }).reasons.join()).toMatch(/not checked/);
    expect(smartVerdict(token(), null, { now: NOW }).good.join()).toMatch(/deep pool/);
    expect(smartVerdict(token(), { ...clean, isHoneypot: true }, { now: NOW }).reasons.join()).toMatch(/honeypot/);
    expect(smartVerdict(token({ createdAt: NOW - 5 * 60_000 }), clean, { now: NOW }).reasons.join()).toMatch(/20 minutes/);
    expect(smartVerdict(token({ buys24h: 300, sells24h: 900 }), clean, { now: NOW }).reasons.join()).toMatch(/Sellers in control/);
    expect(smartVerdict(token({ marketCapUsd: 10_000_000, liquidityUsd: 100_000 }), clean, { now: NOW }).reasons.join()).toMatch(/40 times/);
  });

  it('prefers the healthier of two passing tokens', () => {
    const strong = smartVerdict(token({ buys24h: 2000, sells24h: 700, liquidityUsd: 600_000 }), clean, { now: NOW });
    const weak = smartVerdict(token({ buys24h: 1100, sells24h: 950, change1h: 1 }), clean, { now: NOW });
    expect(strong.points).toBeGreaterThan(weak.points);
  });
});
