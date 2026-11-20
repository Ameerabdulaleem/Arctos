import { describe, expect, it } from 'vitest';
import fixtures from './__fixtures__/providers.json';
import { checkEvmPlan, extraNative, rankQuotes } from './aggregate';
import { EVM_NATIVE, SOL_MINT, SOLANA_ID } from './chains';
import { afterSlippage } from './http';
import { parseKyberBuild, parseKyberRoute, parseSushi, parseZeroxQuote, sushiPlan } from './providers/evm';
import { checkRelayQuote, parseRelayQuote, recipientFor, relayCurrency } from './providers/relay';
import { jupiterPlan, parseJupiterOrder } from './providers/solana';
import { parseSquidRoute, squidPlan } from './providers/squid';
import { fromRelayCurrency } from './tokens';
import type { Plan, Quote, QuoteRequest, Token } from './types';

const WALLET = '0x1111111111111111111111111111111111111111';
const BNB: Token = { chainId: 56, address: EVM_NATIVE, symbol: 'BNB', name: 'BNB', decimals: 18 };
const USDT_BSC: Token = { chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether', decimals: 18 };
const SOL: Token = { chainId: SOLANA_ID, address: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 };
const USDC_SOL: Token = { chainId: SOLANA_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 };
const USDC_ARB: Token = { chainId: 42161, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 };

function req(from: Token, to: Token, amount: bigint, extra: Partial<QuoteRequest> = {}): QuoteRequest {
  return { from, to, amount, sender: WALLET, recipient: null, slippageBps: 50, ...extra };
}

type EvmPlan = Extract<Plan, { vm: 'evm' }>;

describe('KyberSwap', () => {
  const r = req(BNB, USDT_BSC, 10_000_000_000_000_000n);

  it('reads a real route', () => {
    const q = parseKyberRoute(fixtures.kyberRoute, r);
    expect(q.amountOut).toBe(5741247686892992865n);
    expect(q.minOut).toBe(afterSlippage(5741247686892992865n, 50));
    expect(q.gasUsd).toBeCloseTo(0.00825, 4);
    expect(q.route[0]).toMatch(/Pancake/);
  });

  it('builds a native sale that passes the checks', () => {
    const q = parseKyberRoute(fixtures.kyberRoute, r);
    const plan = parseKyberBuild(fixtures.kyberBuild, r, q) as EvmPlan;
    expect(plan.approval).toBeNull();
    expect(plan.tx.to).toBe('0x6131B5fae19EA4f9D964eAc0408E4408b66337b5');
    expect(plan.tx.value).toBe(r.amount);
    expect(() => checkEvmPlan(plan, r)).not.toThrow();
  });

  it('refuses a router that changed between quote and build', () => {
    const q = parseKyberRoute(fixtures.kyberRoute, r);
    const tampered = structuredClone(fixtures.kyberBuild);
    tampered.data.routerAddress = '0x9999999999999999999999999999999999999999';
    expect(() => parseKyberBuild(tampered, r, q)).toThrow(/changed its router/);
  });

  it('refuses an error answer', () => {
    expect(() => parseKyberRoute({ code: 4000, message: 'bad request' }, r)).toThrow(/bad request/);
  });
});

describe('Sushi', () => {
  const r = req(USDT_BSC, BNB, 1_000_000_000_000_000_000n);

  it('reads a real token sale and approves exactly the router it calls', () => {
    const q = parseSushi(fixtures.sushiErc20, r, WALLET);
    const plan = sushiPlan(q, r) as EvmPlan;
    expect(plan.approval).toEqual({ token: USDT_BSC.address, spender: plan.tx.to, amount: r.amount });
    expect(plan.tx.value).toBe(0n);
    expect(() => checkEvmPlan(plan, r)).not.toThrow();
  });

  it('refuses a transaction built for another wallet', () => {
    const q = parseSushi(fixtures.sushiErc20, r, WALLET);
    expect(() => sushiPlan(q, { ...r, sender: '0x2222222222222222222222222222222222222222' })).toThrow(/another wallet/);
  });

  it('treats NoWay as no route', () => {
    expect(() => parseSushi({ status: 'NoWay' }, r, null)).toThrow(/no route/);
  });
});

describe('0x', () => {
  const r = req(USDT_BSC, BNB, 1_000n);
  const answer = (to: string, allowanceTarget = to) => ({
    liquidityAvailable: true,
    buyAmount: '900',
    minBuyAmount: '895',
    allowanceTarget,
    transaction: { to, data: '0x1234abcd', gas: '200000', value: '0' },
  });

  it('accepts only the AllowanceHolder contract', () => {
    const plan = parseZeroxQuote(answer('0x0000000000001fF3684f28c67538d4D072C22734'), r) as EvmPlan;
    expect(plan.approval?.spender).toBe('0x0000000000001fF3684f28c67538d4D072C22734');
    expect(() => checkEvmPlan(plan, r)).not.toThrow();
    // Approving 0x Settler directly can lose funds, so anything else is refused.
    expect(() => parseZeroxQuote(answer('0x7f6ceE965959295cC64d0E6c00d99d6532d8e86b'), r)).toThrow(/AllowanceHolder/);
    expect(() => parseZeroxQuote(answer('0x0000000000001fF3684f28c67538d4D072C22734', '0x7f6ceE965959295cC64d0E6c00d99d6532d8e86b'), r)).toThrow(/unexpected contract/);
  });
});

describe('Jupiter', () => {
  it('reads a real order', () => {
    const q = parseJupiterOrder(fixtures.jupiterQuote, null);
    expect(q.amountOut).toBe(723774n);
    expect(q.minOut).toBe(720155n);
    expect(q.feeNote).toMatch(/0.02%/);
    expect(q.outUsd).toBeGreaterThan(0.7);
  });

  it('needs a transaction before anything is signed', () => {
    expect(() => jupiterPlan(fixtures.jupiterQuote)).toThrow();
    expect(() => parseJupiterOrder({ errorCode: 'TOKEN_NOT_TRADABLE', error: 'not tradable' }, null)).toThrow(/not tradable/);
  });
});

describe('Relay', () => {
  const recipient = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const r = req(BNB, SOL, 50_000_000_000_000_000n, { sender: '0x000000000000000000000000000000000000dEaD', recipient });

  it('reads a real BNB to SOL bridge quote', () => {
    const q = parseRelayQuote(fixtures.relayBridge, r, r.sender, recipient);
    expect(q.amountOut).toBe(393472143n);
    expect(q.minOut).toBe(385602700n);
    expect(q.route).toEqual(['Relay bridge']);
    expect(q.etaSec).toBe(1);
  });

  it('refuses a quote that pays another address or comes from another wallet', () => {
    expect(() => checkRelayQuote(fixtures.relayBridge, '0x000000000000000000000000000000000000dEaD', recipient)).not.toThrow();
    expect(() => checkRelayQuote(fixtures.relayBridge, '0x000000000000000000000000000000000000dEaD', 'CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr')).toThrow(/another address/);
    expect(() => checkRelayQuote(fixtures.relayBridge, WALLET, recipient)).toThrow(/another wallet/);
  });

  it('writes native coins the way Relay expects', () => {
    expect(relayCurrency(BNB)).toBe('0x0000000000000000000000000000000000000000');
    expect(relayCurrency(SOL)).toBe('11111111111111111111111111111111');
    expect(relayCurrency(USDC_SOL)).toBe(USDC_SOL.address);
  });

  it('needs an explicit recipient across kinds of chain', () => {
    expect(recipientFor(req(BNB, SOL, 1n))).toBeNull();
    expect(recipientFor(req(BNB, USDC_ARB, 1n))).toBe(WALLET);
  });
});

describe('Squid', () => {
  const r = req(USDT_BSC, USDC_ARB, 1_000_000n);
  const route = (extra: Record<string, unknown> = {}) => ({
    route: {
      quoteId: 'q1',
      params: { toAddress: WALLET },
      estimate: { toAmount: '990', toAmountMin: '980', fromAmountUSD: '1', toAmountUSD: '0.99', estimatedRouteDuration: 20, feeCosts: [{ amountUsd: '0.1' }], gasCosts: [{ amountUsd: '0.05' }], actions: [{ provider: 'Axelar' }] },
      transactionRequest: { routeType: 'CALL_BRIDGE_CALL', target: '0xce16F69375520ab01377ce7B88f5BA8C48F8D666', data: '0xabcdef', value: '30000000000000', gasLimit: '400000', ...extra },
    },
  });

  it('reads fees paid on top and approves the router it calls', () => {
    const q = parseSquidRoute(route(), WALLET, WALLET);
    expect(q.feeUsd).toBeCloseTo(0.1);
    expect(q.gasUsd).toBeCloseTo(0.05);
    const plan = squidPlan(route(), 'req-1', r) as EvmPlan;
    expect(plan.approval?.spender).toBe(plan.tx.to);
    expect(plan.track?.quoteId).toBe('q1');
    expect(() => checkEvmPlan(plan, r)).not.toThrow();
    expect(extraNative(plan, r)).toBe(30000000000000n);
  });

  it('refuses deposit address routes and other recipients', () => {
    expect(() => squidPlan(route({ routeType: 'DEPOSIT_ADDRESS_CALLDATA' }), null, r)).toThrow(/deposit address/);
    const other = route();
    other.route.params.toAddress = '0x2222222222222222222222222222222222222222';
    expect(() => squidPlan(other, null, r)).toThrow(/another address/);
  });
});

describe('the checks before a wallet prompt', () => {
  const r = req(USDT_BSC, BNB, 1_000n);
  const base: EvmPlan = {
    vm: 'evm', provider: 'kyberswap', chainId: 56,
    approval: { token: USDT_BSC.address, spender: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', amount: 1_000n },
    tx: { to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', data: '0x1234', value: 0n, gas: null },
    minOut: 1n, track: null,
  };

  it('passes a well formed plan', () => {
    expect(() => checkEvmPlan(base, r)).not.toThrow();
  });

  it('refuses approvals that are larger, to another contract, or for another token', () => {
    expect(() => checkEvmPlan({ ...base, approval: { ...base.approval!, amount: 2n ** 256n - 1n } }, r)).toThrow(/different amount/);
    expect(() => checkEvmPlan({ ...base, approval: { ...base.approval!, spender: '0x9999999999999999999999999999999999999999' } }, r)).toThrow(/other than the one it calls/);
    expect(() => checkEvmPlan({ ...base, approval: { ...base.approval!, token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' } }, r)).toThrow(/another token/);
    expect(() => checkEvmPlan({ ...base, approval: null }, r)).toThrow(/which contract/);
  });

  it('refuses native coin on a token sale, wrong amounts on a native sale, and other chains', () => {
    expect(() => checkEvmPlan({ ...base, tx: { ...base.tx, value: 1n } }, r)).toThrow(/native coin/);
    const native = req(BNB, USDT_BSC, 1_000n);
    const nativePlan: EvmPlan = { ...base, approval: null, tx: { ...base.tx, value: 1_000n } };
    expect(() => checkEvmPlan(nativePlan, native)).not.toThrow();
    expect(() => checkEvmPlan({ ...nativePlan, tx: { ...nativePlan.tx, value: 5_000n } }, native)).toThrow(/different amount/);
    expect(() => checkEvmPlan({ ...base, chainId: 1 }, r)).toThrow(/another chain/);
  });

  it('refuses calls to the token itself or to nowhere', () => {
    expect(() => checkEvmPlan({ ...base, tx: { ...base.tx, to: USDT_BSC.address }, approval: { ...base.approval!, spender: USDT_BSC.address } }, r)).toThrow(/token contract/);
    expect(() => checkEvmPlan({ ...base, tx: { ...base.tx, to: '0x0000000000000000000000000000000000000000' } }, r)).toThrow(/no contract/);
    expect(() => checkEvmPlan({ ...base, tx: { ...base.tx, data: '0x' } }, r)).toThrow(/call data/);
  });
});

describe('ranking', () => {
  const r = req(BNB, USDT_BSC, 1n);
  const q = (provider: Quote['provider'], out: bigint, outUsd: number | null, gasUsd: number | null): Quote => ({
    provider, amountOut: out, minOut: null, inUsd: null, outUsd, gasUsd, feeUsd: null, feeNote: null,
    impactPct: null, etaSec: null, route: [], forSender: null, forRecipient: null, raw: null, at: 0,
  });

  it('puts the best output after costs first', () => {
    const one = 10n ** 18n;
    const ranked = rankQuotes([q('kyberswap', 101n * one, 101, 5), q('relay', 99n * one, 99, 0)], r);
    // Kyber pays the most but its network fee eats the difference.
    expect(ranked.map((x) => x.provider)).toEqual(['relay', 'kyberswap']);
  });

  it('does not reward a provider for leaving out its network fee', () => {
    const one = 10n ** 18n;
    // The real case seen live: Kyber pays slightly more and reports a $0.01 fee, Sushi reports none.
    const ranked = rankQuotes([q('sushi', 18_160_766n * one / 1_000_000n, null, null), q('kyberswap', 18_166_649n * one / 1_000_000n, 28.53, 0.01)], r);
    expect(ranked[0].provider).toBe('kyberswap');
  });

  it('falls back to the raw output without prices', () => {
    const ranked = rankQuotes([q('sushi', 5n, null, null), q('zerox', 7n, null, null)], r);
    expect(ranked[0].provider).toBe('zerox');
  });
});

describe('token lists', () => {
  it('maps Relay natives and rejects junk', () => {
    expect(fromRelayCurrency({ chainId: 56, address: '0x0000000000000000000000000000000000000000', symbol: 'BNB', name: 'BNB', decimals: 18 })?.address).toBe(EVM_NATIVE);
    expect(fromRelayCurrency({ chainId: SOLANA_ID, address: '11111111111111111111111111111111', symbol: 'SOL', name: 'SOL', decimals: 9 })?.address).toBe(SOL_MINT);
    expect(fromRelayCurrency({ chainId: 56, address: 'not an address', symbol: 'X', decimals: 18 })).toBeNull();
    expect(fromRelayCurrency({ chainId: 999999, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'X', decimals: 18 })).toBeNull();
    expect(fromRelayCurrency({ chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'X', decimals: 99 })).toBeNull();
    expect(fromRelayCurrency({ chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'X', decimals: 18, metadata: { logoURI: 'javascript:alert(1)' } })?.logo).toBeUndefined();
  });
});
