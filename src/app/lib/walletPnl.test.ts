import { describe, expect, it } from 'vitest';
import type { WalletTx } from '../swap/solanaHistory';
import { parseWalletTx } from '../swap/solanaHistory';
import { computePnl } from './walletPnl';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = (n: number) => String(Math.round(n * 1e9));
const tx = (time: number, sol: number, tokens: Array<[string, number, number]>, fee = 5000): WalletTx => ({
  sig: `s${time}`, time, fee: String(fee), sol: SOL(sol), tokens: tokens.map(([mint, amount, decimals]) => ({ mint, delta: String(Math.round(amount * 10 ** decimals)), decimals })),
});

describe('wallet profit and loss', () => {
  it('values buys at the SOL price of their hour and sells at what came back', () => {
    const solAt = (t: number) => (t < 2000 ? 100 : 150);
    const txs = [
      tx(1000, -1, [[BONK, 1_000_000, 5]]), // $100 for 1M
      tx(1500, -1, [[BONK, 1_000_000, 5]]), // $100 for 1M more, average $0.0001
      tx(3000, 2, [[BONK, -1_000_000, 5]]), // sold 1M for 2 SOL at $150 = $300
    ];
    const r = computePnl(txs, solAt, new Map([[BONK, 0.00005]]));
    const bonk = r.tokens[0];
    expect(bonk.investedUsd).toBeCloseTo(200);
    expect(bonk.proceedsUsd).toBeCloseTo(300);
    expect(bonk.realizedUsd).toBeCloseTo(200); // 300 back for 100 of cost
    expect(bonk.heldQty).toBeCloseTo(1_000_000);
    expect(bonk.unrealizedUsd).toBeCloseTo(-50); // worth 50 now, cost 100
    expect(r.totals.netUsd).toBeCloseTo(150);
    expect(r.totals.trades).toBe(3);
    expect(r.totals.winRatePct).toBe(100);
  });

  it('counts stablecoin trades at a dollar and splits profit from loss', () => {
    const txs = [
      tx(1000, 0, [[USDC, -50, 6], [WIF, 10, 6]]),
      tx(1100, 0, [[USDC, -50, 6], [BONK, 1000, 5]]),
      tx(1200, 0, [[USDC, 20, 6], [BONK, -1000, 5]]),
    ];
    const r = computePnl(txs, () => 100, new Map([[WIF, 8]]));
    expect(r.tokens.find((t) => t.mint === WIF)?.unrealizedUsd).toBeCloseTo(30);
    expect(r.tokens.find((t) => t.mint === BONK)?.realizedUsd).toBeCloseTo(-30);
    expect(r.totals.profitUsd).toBeCloseTo(30);
    expect(r.totals.lossUsd).toBeCloseTo(-30);
    expect(r.totals.netUsd).toBeCloseTo(0);
  });

  it('leaves tokens received without a trade out of profit and loss', () => {
    const txs = [
      tx(1000, 0, [[BONK, 5_000_000, 5]]), // airdrop
      tx(2000, -1, [[BONK, 1_000_000, 5]]), // bought 1M for $100
      tx(3000, 3, [[BONK, -3_000_000, 5]]), // sold 3M for $300: only 1M had a cost
    ];
    const r = computePnl(txs, () => 100, new Map([[BONK, 0.0001]]));
    const bonk = r.tokens[0];
    expect(r.skipped.transfers).toBe(1);
    expect(bonk.realizedUsd).toBeCloseTo(0); // $100 back for the $100 bought
    expect(bonk.heldQty).toBe(0);
  });

  it('moves cost across a token for token swap and skips what it cannot price', () => {
    const txs = [
      tx(1000, -1, [[BONK, 1_000_000, 5]]),
      tx(2000, 0, [[BONK, -1_000_000, 5], [WIF, 50, 6]]),
      tx(3000, -1, [[WIF, 10, 6]]),
    ];
    const r = computePnl(txs, (t) => (t === 3000 ? null : 100), new Map([[WIF, 3]]));
    const wif = r.tokens.find((t) => t.mint === WIF)!;
    expect(wif.costUsd).toBeCloseTo(100);
    expect(wif.unrealizedUsd).toBeCloseTo(50);
    expect(r.skipped.unpriced).toBe(1);
    expect(r.totals.swaps).toBe(1);
  });

  it('counts wrapped SOL paid or received as SOL', () => {
    const WSOL = 'So11111111111111111111111111111111111111112';
    const txs = [
      tx(1000, 0, [[WSOL, -2, 9], [WIF, 100, 6]]), // 2 wrapped SOL at $100 for 100 WIF
      tx(2000, 0, [[WIF, -50, 6], [WSOL, 3, 9]]), // half sold for 3 wrapped SOL
    ];
    const r = computePnl(txs, () => 100, new Map([[WIF, 4]]));
    expect(r.tokens.map((t) => t.mint)).toEqual([WIF]);
    const wif = r.tokens[0];
    expect(wif.investedUsd).toBeCloseTo(200);
    expect(wif.realizedUsd).toBeCloseTo(200); // $300 back for $100 of cost
    expect(wif.unrealizedUsd).toBeCloseTo(100); // 50 left worth $200, cost $100
    expect(r.totals.swaps).toBe(0);
  });

  it('caps the book at what the wallet still holds', () => {
    const r = computePnl([tx(1000, -1, [[BONK, 1_000_000, 5]])], () => 100, new Map([[BONK, 0.0001]]), new Map([[BONK, 250_000]]));
    expect(r.tokens[0].heldQty).toBe(250_000);
    expect(r.tokens[0].costUsd).toBeCloseTo(25);
  });
});

describe('reading a Solana transaction', () => {
  const wallet = 'Wa11et1111111111111111111111111111111111111';
  it('takes the fee and new token account rent out of the SOL paid', () => {
    const raw = {
      blockTime: 1_795_000_000, meta: { err: null, fee: 5000, preBalances: [10_000_000_000, 0], postBalances: [8_997_955_720, 0],
        preTokenBalances: [], postTokenBalances: [{ accountIndex: 2, mint: BONK, owner: wallet, uiTokenAmount: { amount: '100000000000', decimals: 5 } }] },
      transaction: { message: { accountKeys: [{ pubkey: wallet }, { pubkey: 'Other1111111111111111111111111111111111111' }] } },
    };
    const t = parseWalletTx(raw, wallet, 'sig')!;
    // 10 SOL to 8.99795572: 1 SOL paid, plus the 5000 fee and the 2,039,280 rent.
    expect(t.sol).toBe(String(-1_000_000_000));
    expect(t.tokens).toEqual([{ mint: BONK, delta: '100000000000', decimals: 5 }]);
    expect(t.time).toBe(1_795_000_000_000);
    expect(parseWalletTx({ ...raw, meta: { ...raw.meta, err: { InstructionError: [] } } }, wallet, 'sig')).toBeNull();
  });
});
