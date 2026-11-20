// Opt in check against the real providers: SWAP_LIVE=1 npx vitest run src/app/swap/live.test.ts
// Quotes only, plus building (never sending) transactions for a placeholder wallet.

import { describe, expect, it } from 'vitest';
import { checkEvmPlan, getQuotes } from './aggregate';
import { chainById, SOLANA_ID } from './chains';
import { kyberswap, sushi } from './providers/evm';
import { featuredTokens, nativeToken, searchTokens } from './tokens';
import type { ProviderContext, QuoteRequest, Token } from './types';

const LIVE = Boolean(process.env.SWAP_LIVE);
const ctx: ProviderContext = { relayBase: 'https://api.relay.link', zerox: false, squid: false };
const WALLET = '0x1111111111111111111111111111111111111111';
const bsc = chainById(56)!;
const sol = chainById(SOLANA_ID)!;
const USDT_BSC: Token = { chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether', decimals: 18 };
const USDC_SOL: Token = { chainId: SOLANA_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 };

describe.skipIf(!LIVE)('live providers', () => {
  it('compares BNB to USDT on BNB Chain and builds checked transactions', async () => {
    const req: QuoteRequest = { from: nativeToken(bsc), to: USDT_BSC, amount: 10n ** 16n, sender: null, recipient: null, slippageBps: 50 };
    const res = await getQuotes(req, ctx, new AbortController().signal);
    console.log('BSC', res.quotes.map((q) => [q.provider, q.amountOut.toString()]), res.failures);
    expect(res.quotes.map((q) => q.provider)).toEqual(expect.arrayContaining(['kyberswap', 'sushi']));
    const withWallet = { ...req, sender: WALLET };
    for (const p of [kyberswap, sushi]) {
      const quote = res.quotes.find((q) => q.provider === p.id)!;
      const plan = await p.plan(quote, withWallet, ctx, new AbortController().signal);
      if (plan.vm !== 'evm') throw new Error('expected an EVM plan');
      checkEvmPlan(plan, withWallet);
      expect(plan.tx.value).toBe(req.amount);
    }
  }, 60_000);

  it('compares SOL to USDC on Solana', async () => {
    const req: QuoteRequest = { from: nativeToken(sol), to: USDC_SOL, amount: 10_000_000n, sender: null, recipient: null, slippageBps: 50 };
    const res = await getQuotes(req, ctx, new AbortController().signal);
    console.log('SOL', res.quotes.map((q) => [q.provider, q.amountOut.toString()]), res.failures);
    expect(res.quotes.map((q) => q.provider)).toContain('jupiter');
  }, 60_000);

  it('bridges BNB to SOL through Relay', async () => {
    const req: QuoteRequest = { from: nativeToken(bsc), to: nativeToken(sol), amount: 5n * 10n ** 16n, sender: null, recipient: null, slippageBps: 100 };
    const res = await getQuotes(req, ctx, new AbortController().signal);
    console.log('BRIDGE', res.quotes.map((q) => [q.provider, q.amountOut.toString(), q.etaSec]), res.failures);
    expect(res.quotes[0]?.provider).toBe('relay');
  }, 60_000);

  it('finds tokens by name and lists featured ones', async () => {
    const found = await searchTokens(ctx, bsc, 'cake', new AbortController().signal);
    expect(found.some((t) => t.symbol.toLowerCase() === 'cake')).toBe(true);
    const featured = await featuredTokens(ctx);
    expect((featured.get(SOLANA_ID) ?? []).some((t) => t.symbol === 'USDC')).toBe(true);
  }, 60_000);
});
