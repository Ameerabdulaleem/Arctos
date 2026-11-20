// Same chain EVM aggregators: KyberSwap, 0x and Sushi.
// KyberSwap and Sushi are called straight from the browser (both allow it and need no key).
// 0x needs a key, so its calls go through this site's data service, which adds it.

import { API_BASE } from '../../services/api';
import { chainById, EVM_NATIVE, isNative } from '../chains';
import { addressOf, afterSlippage, bigOf, bigOrNull, fetchJson, hexOf, numOrNull, obj, ProviderError, unique } from '../http';
import type { Approval, Plan, Quote, QuoteRequest, SwapProvider, Token } from '../types';

const FIRM_FOR_MS = 20_000;
const PLACEHOLDER = '0x000000000000000000000000000000000000dEaD';

function sameChainEvm(req: QuoteRequest): boolean {
  const chain = chainById(req.from.chainId);
  return Boolean(chain && chain.vm === 'evm' && req.from.chainId === req.to.chainId);
}

function evmAddress(token: Token): string {
  const chain = chainById(token.chainId);
  return chain && isNative(chain, token.address) ? EVM_NATIVE : token.address;
}

function sellsNative(req: QuoteRequest): boolean {
  const chain = chainById(req.from.chainId);
  return Boolean(chain && isNative(chain, req.from.address));
}

function prettyDex(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bV(\d)/gi, 'V$1')
    .trim();
}

/** An exact approval of the input to the very contract the swap calls, or none for a native coin. */
function approvalFor(req: QuoteRequest, spender: string): Approval {
  return sellsNative(req) ? null : { token: req.from.address, spender, amount: req.amount };
}

// ---------------------------------------------------------------- KyberSwap

const KYBER = 'KyberSwap';
const KYBER_BASE = 'https://aggregator-api.kyberswap.com';
const KYBER_HEADERS = { 'x-client-id': 'arctos' };

export function parseKyberRoute(body: unknown, req: QuoteRequest): Quote {
  const root = obj(KYBER, body, 'a route');
  if (root.code !== 0) throw new ProviderError(KYBER, typeof root.message === 'string' ? root.message : 'found no route');
  const data = obj(KYBER, root.data, 'route data');
  const summary = obj(KYBER, data.routeSummary, 'a route summary');
  const amountOut = bigOf(KYBER, summary.amountOut, 'output amount');
  const hops = Array.isArray(summary.route) ? (summary.route as unknown[]).flat() : [];
  const dexes = hops.map((h) => (h && typeof h === 'object' ? String((h as Record<string, unknown>).exchange ?? '') : ''));
  const inUsd = numOrNull(summary.amountInUsd);
  const outUsd = numOrNull(summary.amountOutUsd);
  return {
    provider: 'kyberswap',
    amountOut,
    minOut: afterSlippage(amountOut, req.slippageBps),
    inUsd,
    outUsd,
    gasUsd: numOrNull(summary.gasUsd),
    feeUsd: null,
    feeNote: null,
    impactPct: null,
    etaSec: null,
    route: unique(dexes.map(prettyDex)).slice(0, 4),
    forSender: null,
    forRecipient: null,
    raw: summary,
    at: Date.now(),
  };
}

export function parseKyberBuild(body: unknown, req: QuoteRequest, quote: Quote): Plan {
  const root = obj(KYBER, body, 'a transaction');
  if (root.code !== 0) throw new ProviderError(KYBER, typeof root.message === 'string' ? root.message : 'could not build the swap');
  const data = obj(KYBER, root.data, 'transaction data');
  const router = addressOf(KYBER, data.routerAddress, 'router address');
  const summaryRouter = (quote.raw as Record<string, unknown>).routerAddress;
  if (typeof summaryRouter === 'string' && summaryRouter.toLowerCase() !== router.toLowerCase()) {
    throw new ProviderError(KYBER, 'changed its router between quote and swap');
  }
  const amountOut = bigOf(KYBER, data.amountOut, 'output amount');
  return {
    vm: 'evm',
    provider: 'kyberswap',
    chainId: req.from.chainId,
    approval: approvalFor(req, router),
    tx: { to: router, data: hexOf(KYBER, data.data, 'call data'), value: bigOrNull(data.transactionValue) ?? 0n, gas: null },
    minOut: afterSlippage(amountOut, req.slippageBps),
    track: null,
  };
}

export const kyberswap: SwapProvider = {
  id: 'kyberswap',
  label: KYBER,
  supports: (req) => sameChainEvm(req) && Boolean(chainById(req.from.chainId)?.kyber),
  async quote(req, _ctx, signal) {
    const slug = chainById(req.from.chainId)?.kyber;
    const q = new URLSearchParams({ tokenIn: evmAddress(req.from), tokenOut: evmAddress(req.to), amountIn: req.amount.toString() });
    const { body } = await fetchJson(KYBER, `${KYBER_BASE}/${slug}/api/v1/routes?${q}`, { signal, headers: KYBER_HEADERS });
    return parseKyberRoute(body, req);
  },
  async plan(quote, req, _ctx, signal) {
    if (!req.sender) throw new ProviderError(KYBER, 'needs a connected wallet');
    const slug = chainById(req.from.chainId)?.kyber;
    const { body } = await fetchJson(KYBER, `${KYBER_BASE}/${slug}/api/v1/route/build`, {
      method: 'POST',
      signal,
      headers: KYBER_HEADERS,
      body: {
        routeSummary: quote.raw,
        sender: req.sender,
        recipient: req.sender,
        slippageTolerance: req.slippageBps,
        deadline: Math.floor(Date.now() / 1000) + 20 * 60,
        source: 'arctos',
      },
    });
    return parseKyberBuild(body, req, quote);
  },
};

// ---------------------------------------------------------------- 0x

const ZEROX = '0x';
/** 0x AllowanceHolder, the only contract 0x says to approve (Cancun chains, and Mantle). */
export const ZEROX_ALLOWANCE_HOLDERS = ['0x0000000000001ff3684f28c67538d4d072c22734', '0x0000000000005e88410ccdfade4a5efae4b49562'];
const ZEROX_CHAINS = new Set([1, 56, 8453, 42161, 137, 10, 43114, 59144, 146]);

function zeroxParams(req: QuoteRequest, taker: string | null): URLSearchParams {
  const q = new URLSearchParams({
    chainId: String(req.from.chainId),
    sellToken: evmAddress(req.from),
    buyToken: evmAddress(req.to),
    sellAmount: req.amount.toString(),
    slippageBps: String(req.slippageBps),
  });
  if (taker) q.set('taker', taker);
  return q;
}

export function parseZeroxPrice(body: unknown, req: QuoteRequest): Quote {
  const root = obj(ZEROX, body, 'a price');
  if (root.liquidityAvailable === false) throw new ProviderError(ZEROX, 'found no route');
  const amountOut = bigOf(ZEROX, root.buyAmount, 'output amount');
  const fills = (root.route as { fills?: unknown[] } | undefined)?.fills ?? [];
  const sources = fills.map((f) => (f && typeof f === 'object' ? String((f as Record<string, unknown>).source ?? '') : ''));
  const fees = root.fees as Record<string, unknown> | undefined;
  return {
    provider: 'zerox',
    amountOut,
    minOut: bigOrNull(root.minBuyAmount) ?? afterSlippage(amountOut, req.slippageBps),
    inUsd: null,
    outUsd: null,
    gasUsd: null,
    feeUsd: null,
    feeNote: fees?.zeroExFee ? '0x fee already in the amount' : null,
    impactPct: null,
    etaSec: null,
    route: unique(sources.map(prettyDex)).slice(0, 4),
    forSender: null,
    forRecipient: null,
    raw: body,
    at: Date.now(),
  };
}

export function parseZeroxQuote(body: unknown, req: QuoteRequest): Plan {
  const root = obj(ZEROX, body, 'a quote');
  if (root.liquidityAvailable === false) throw new ProviderError(ZEROX, 'found no route');
  const tx = obj(ZEROX, root.transaction, 'a transaction');
  const to = addressOf(ZEROX, tx.to, 'contract address');
  if (!ZEROX_ALLOWANCE_HOLDERS.includes(to.toLowerCase())) throw new ProviderError(ZEROX, 'asked to call a contract that is not its AllowanceHolder');
  const target = root.allowanceTarget;
  if (typeof target === 'string' && target.toLowerCase() !== to.toLowerCase()) throw new ProviderError(ZEROX, 'asked for an approval to an unexpected contract');
  const amountOut = bigOf(ZEROX, root.buyAmount, 'output amount');
  return {
    vm: 'evm',
    provider: 'zerox',
    chainId: req.from.chainId,
    approval: approvalFor(req, to),
    tx: { to, data: hexOf(ZEROX, tx.data, 'call data'), value: bigOrNull(tx.value) ?? 0n, gas: bigOrNull(tx.gas) },
    minOut: bigOrNull(root.minBuyAmount) ?? afterSlippage(amountOut, req.slippageBps),
    track: null,
  };
}

export const zerox: SwapProvider = {
  id: 'zerox',
  label: ZEROX,
  supports: (req, ctx) => ctx.zerox && sameChainEvm(req) && ZEROX_CHAINS.has(req.from.chainId),
  async quote(req, _ctx, signal) {
    const { body } = await fetchJson(ZEROX, `${API_BASE}/api/zerox/swap/allowance-holder/price?${zeroxParams(req, req.sender)}`, { signal });
    return parseZeroxPrice(body, req);
  },
  async plan(_quote, req, _ctx, signal) {
    if (!req.sender) throw new ProviderError(ZEROX, 'needs a connected wallet');
    const { body } = await fetchJson(ZEROX, `${API_BASE}/api/zerox/swap/allowance-holder/quote?${zeroxParams(req, req.sender)}`, { signal });
    return parseZeroxQuote(body, req);
  },
};

// ---------------------------------------------------------------- Sushi

const SUSHI = 'Sushi';
const SUSHI_BASE = 'https://api.sushi.com/swap/v7';

export function parseSushi(body: unknown, req: QuoteRequest, sender: string | null): Quote {
  const root = obj(SUSHI, body, 'a route');
  if (root.status !== 'Success') throw new ProviderError(SUSHI, 'found no route');
  const amountOut = bigOf(SUSHI, root.assumedAmountOut, 'output amount');
  const impact = numOrNull(root.priceImpact);
  return {
    provider: 'sushi',
    amountOut,
    minOut: afterSlippage(amountOut, req.slippageBps),
    inUsd: null,
    outUsd: null,
    gasUsd: null,
    feeUsd: null,
    feeNote: null,
    impactPct: impact == null ? null : -Math.abs(impact * 100),
    etaSec: null,
    route: ['Sushi aggregator'],
    forSender: sender,
    forRecipient: sender,
    raw: body,
    at: Date.now(),
  };
}

export function sushiPlan(quote: Quote, req: QuoteRequest): Plan {
  const root = obj(SUSHI, quote.raw, 'a route');
  const tx = obj(SUSHI, root.tx, 'a transaction');
  if (typeof tx.from !== 'string' || !req.sender || tx.from.toLowerCase() !== req.sender.toLowerCase()) {
    throw new ProviderError(SUSHI, 'built the swap for another wallet');
  }
  const to = addressOf(SUSHI, tx.to, 'router address');
  return {
    vm: 'evm',
    provider: 'sushi',
    chainId: req.from.chainId,
    approval: approvalFor(req, to),
    tx: { to, data: hexOf(SUSHI, tx.data, 'call data'), value: bigOrNull(tx.value) ?? 0n, gas: bigOrNull(tx.gas) },
    minOut: quote.minOut,
    track: null,
  };
}

async function sushiQuote(req: QuoteRequest, sender: string | null, signal: AbortSignal): Promise<Quote> {
  const q = new URLSearchParams({
    tokenIn: evmAddress(req.from),
    tokenOut: evmAddress(req.to),
    amount: req.amount.toString(),
    maxSlippage: String(req.slippageBps / 10_000),
    sender: sender ?? PLACEHOLDER,
  });
  const { body } = await fetchJson(SUSHI, `${SUSHI_BASE}/${req.from.chainId}?${q}`, { signal });
  return parseSushi(body, req, sender);
}

export const sushi: SwapProvider = {
  id: 'sushi',
  label: SUSHI,
  supports: (req) => sameChainEvm(req),
  quote: (req, _ctx, signal) => sushiQuote(req, req.sender, signal),
  async plan(quote, req, _ctx, signal) {
    if (!req.sender) throw new ProviderError(SUSHI, 'needs a connected wallet');
    const fresh = quote.forSender === req.sender && Date.now() - quote.at < FIRM_FOR_MS;
    return sushiPlan(fresh ? quote : await sushiQuote(req, req.sender, signal), req);
  },
};
