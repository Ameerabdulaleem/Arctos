// Jupiter, the main Solana swap aggregator. Swap API v2: one call returns the quote and,
// for a wallet, the transaction; Jupiter then lands the signed transaction.

import { chainById, SOLANA_ID } from '../chains';
import { bigOf, bigOrNull, fetchJson, numOrNull, obj, ProviderError, strOf, unique } from '../http';
import type { Plan, Quote, QuoteRequest, SwapProvider } from '../types';

const NAME = 'Jupiter';
export const JUPITER_BASE = 'https://api.jup.ag/swap/v2';

function orderUrl(req: QuoteRequest, taker: string | null): string {
  const q = new URLSearchParams({
    inputMint: req.from.address,
    outputMint: req.to.address,
    amount: req.amount.toString(),
    slippageBps: String(req.slippageBps),
  });
  if (taker) q.set('taker', taker);
  return `${JUPITER_BASE}/order?${q}`;
}

export function parseJupiterOrder(body: unknown, sender: string | null): Quote {
  const root = obj(NAME, body, 'an order');
  if (typeof root.errorCode === 'string' || typeof root.errorCode === 'number') {
    throw new ProviderError(NAME, typeof root.error === 'string' ? root.error : 'found no route');
  }
  const plan = Array.isArray(root.routePlan) ? root.routePlan : [];
  const labels = plan.map((p) => String((p as { swapInfo?: { label?: unknown } })?.swapInfo?.label ?? ''));
  const feeBps = numOrNull(root.feeBps);
  return {
    provider: 'jupiter',
    amountOut: bigOf(NAME, root.outAmount, 'output amount'),
    minOut: bigOrNull(root.otherAmountThreshold),
    inUsd: numOrNull(root.inUsdValue),
    outUsd: numOrNull(root.outUsdValue),
    gasUsd: null,
    feeUsd: null,
    feeNote: feeBps != null && feeBps > 0 ? `Jupiter fee ${(feeBps / 100).toFixed(2)}%, already in the amount` : null,
    impactPct: numOrNull(root.priceImpact),
    etaSec: null,
    route: unique(labels).slice(0, 4),
    forSender: sender,
    forRecipient: sender,
    raw: body,
    at: Date.now(),
  };
}

export function jupiterPlan(body: unknown): Plan {
  const root = obj(NAME, body, 'an order');
  if (typeof root.transaction !== 'string' || root.transaction.length < 100) {
    const why = typeof root.errorMessage === 'string' ? root.errorMessage : typeof root.error === 'string' ? root.error : 'could not build the swap for this wallet';
    throw new ProviderError(NAME, why);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(root.transaction)) throw new ProviderError(NAME, 'sent a transaction it could not read');
  return {
    vm: 'svm',
    provider: 'jupiter',
    transaction: root.transaction,
    requestId: strOf(NAME, root.requestId, 'a request id'),
    minOut: bigOrNull(root.otherAmountThreshold),
  };
}

export const jupiter: SwapProvider = {
  id: 'jupiter',
  label: NAME,
  supports: (req) => req.from.chainId === SOLANA_ID && req.to.chainId === SOLANA_ID && chainById(SOLANA_ID) !== undefined,
  async quote(req, _ctx, signal) {
    // No taker here: an indicative quote, so no transaction is built for every refresh.
    const { body } = await fetchJson(NAME, orderUrl(req, null), { signal });
    return parseJupiterOrder(body, null);
  },
  async plan(_quote, req, _ctx, signal) {
    if (!req.sender) throw new ProviderError(NAME, 'needs a connected Solana wallet');
    const { body } = await fetchJson(NAME, orderUrl(req, req.sender), { signal });
    return jupiterPlan(body);
  },
};
