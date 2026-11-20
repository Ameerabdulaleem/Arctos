import { describe, expect, it } from 'vitest';
import { readPairs } from './dexscreener';
import { dueAlerts, type WalletSnipe } from '../lib/walletSnipes';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('DexScreener pairs', () => {
  it('keeps safe links and images, deepest pool first', () => {
    const pairs = readPairs([
      { chainId: 'solana', dexId: 'orca', pairAddress: 'PoolSmallAAAAAAAAAAAAAAAAAAAAAAAA', baseToken: { address: MINT, symbol: 'BONK', name: 'Bonk' }, liquidity: { usd: 10 } },
      {
        chainId: 'solana', dexId: 'raydium', pairAddress: 'PoolDeepAAAAAAAAAAAAAAAAAAAAAAAAA', url: 'https://dexscreener.com/solana/pooldeep',
        baseToken: { address: MINT, symbol: 'BONK', name: 'Bonk<script>' }, quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
        priceUsd: '0.0000021', priceChange: { m5: 0.1, h24: '-8.8' }, txns: { h1: { buys: 10, sells: 4 } }, liquidity: { usd: 211400 }, marketCap: 185e6,
        info: {
          imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/solana/bonk.png', header: 'https://evil.example/x.png',
          websites: [{ label: 'Website', url: 'https://bonkcoin.com' }, { label: 'Bad', url: 'javascript:alert(1)' }],
          socials: [{ type: 'twitter', url: 'https://twitter.com/bonk_inu' }, { type: 'telegram', url: 'http://t.me/plain' }],
        },
      },
      { chainId: 'solana', pairAddress: 'x', baseToken: { address: MINT } },
    ]);
    expect(pairs).toHaveLength(2);
    const [deep] = pairs;
    expect(deep.dexId).toBe('raydium');
    expect(deep.base.name).toBe('Bonk script');
    expect(deep.change.h24).toBe(-8.8);
    expect(deep.change.h1).toBeNull();
    expect(deep.txns.h1).toEqual({ buys: 10, sells: 4 });
    expect(deep.imageUrl).toMatch(/^https:\/\/dd\.dexscreener\.com\//);
    expect(deep.header).toBeNull();
    expect(deep.websites.map((w) => w.url)).toEqual(['https://bonkcoin.com/']);
    expect(deep.socials.map((s) => s.type)).toEqual(['twitter']);
  });

  it('reads the search shape too', () => {
    expect(readPairs({ pairs: [{ chainId: 'bsc', pairAddress: '0x1111111111111111111111111111111111111111', baseToken: { address: '0x2222222222222222222222222222222222222222' } }] })).toHaveLength(1);
    expect(readPairs('nonsense')).toEqual([]);
  });
});

describe('wallet snipe alerts', () => {
  const snipe: WalletSnipe = { id: 'solana:x', chain: 'solana', address: 'x', symbol: 'X', name: 'X', entryPriceUsd: 1, qty: 100, spent: '0.1 SOL', at: 0, link: null, alerted: [] };
  const plan = { takeProfits: [{ enabled: true, gainPct: 80, sellPct: 60 }, { enabled: false, gainPct: 100, sellPct: 20 }, { enabled: true, gainPct: 400, sellPct: 20 }], stopLossPct: 20 };

  it('fires each reached target once', () => {
    expect(dueAlerts(snipe, 1.5, plan)).toEqual([]);
    expect(dueAlerts(snipe, 2.1, plan).map((a) => a.id)).toEqual(['tp1']);
    expect(dueAlerts({ ...snipe, alerted: ['tp1'] }, 2.1, plan)).toEqual([]);
    expect(dueAlerts(snipe, 6, plan).map((a) => [a.id, a.sellPct])).toEqual([['tp1', 60], ['tp3', 20]]);
    expect(dueAlerts(snipe, 0.75, plan).map((a) => [a.id, a.sellPct])).toEqual([['sl', 100]]);
    expect(dueAlerts(snipe, null, plan)).toEqual([]);
  });
});
