// Squid: cross chain routes between EVM chains (Axelar, CCTP, Chainflip and others).
// Squid needs an integrator id, so its calls go through this site's data service.

import { API_BASE } from '../../services/api';
import { chainById, EVM_NATIVE, isNative } from '../chains';
import { addressOf, bigOf, bigOrNull, fetchJson, hexOf, numOrNull, obj, ProviderError, strOf, unique } from '../http';
import type { Plan, Quote, QuoteRequest, SwapProvider, Token } from '../types';

const NAME = 'Squid';
const PLACEHOLDER = '0x000000000000000000000000000000000000dEaD';
/** Route types that are a plain contract call on the source chain, the only kind run here. */
const CONTRACT_CALL_TYPES = new Set(['ON_CHAIN_EXECUTION', 'CALL_BRIDGE_CALL', 'CALL_BRIDGE', 'BRIDGE_CALL', 'BRIDGE', 'EVM_ONLY']);

function squidToken(token: Token): string {
  const chain = chainById(token.chainId);
  return chain && isNative(chain, token.address) ? EVM_NATIVE : token.address;
}

function sumUsd(list: unknown): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  let total = 0;
  for (const item of list) {
    const usd = numOrNull((item as { amountUsd?: unknown })?.amountUsd);
    if (usd != null) total += usd;
  }
  return total;
}

function routeBody(req: QuoteRequest, sender: string | null, firm: boolean) {
  const from = chainById(req.from.chainId);
  const to = chainById(req.to.chainId);
  return {
    fromChain: from?.squid,
    toChain: to?.squid,
    fromToken: squidToken(req.from),
    toToken: squidToken(req.to),
    fromAmount: req.amount.toString(),
    fromAddress: sender ?? PLACEHOLDER,
    toAddress: req.recipient ?? sender ?? PLACEHOLDER,
    slippage: Math.max(0.01, req.slippageBps / 100),
    quoteOnly: !firm,
  };
}

export function parseSquidRoute(body: unknown, sender: string | null, recipient: string | null): Quote {
  const route = obj(NAME, obj(NAME, body, 'a route').route, 'a route');
  const est = obj(NAME, route.estimate, 'an estimate');
  const actions = Array.isArray(est.actions) ? est.actions : [];
  const providers = actions.map((a) => String((a as { provider?: unknown })?.provider ?? ''));
  return {
    provider: 'squid',
    amountOut: bigOf(NAME, est.toAmount, 'output amount'),
    minOut: bigOrNull(est.toAmountMin),
    inUsd: numOrNull(est.fromAmountUSD),
    outUsd: numOrNull(est.toAmountUSD),
    gasUsd: sumUsd(est.gasCosts),
    feeUsd: sumUsd(est.feeCosts),
    feeNote: null,
    impactPct: numOrNull(est.aggregatePriceImpact),
    etaSec: numOrNull(est.estimatedRouteDuration),
    route: unique(providers).slice(0, 4),
    forSender: sender,
    forRecipient: recipient,
    raw: body,
    at: Date.now(),
  };
}

export function squidPlan(body: unknown, requestId: string | null, req: QuoteRequest): Plan {
  const route = obj(NAME, obj(NAME, body, 'a route').route, 'a route');
  const tx = obj(NAME, route.transactionRequest, 'a transaction');
  const kind = tx.routeType ?? tx.type ?? route.transactionType;
  if (typeof kind === 'string' && !CONTRACT_CALL_TYPES.has(kind)) {
    throw new ProviderError(NAME, 'offered a deposit address route, which Arctos does not run. Pick another quote.');
  }
  const params = route.params as Record<string, unknown> | undefined;
  const recipient = req.recipient ?? req.sender ?? '';
  if (params && typeof params.toAddress === 'string' && params.toAddress.toLowerCase() !== recipient.toLowerCase()) {
    throw new ProviderError(NAME, 'returned a route that pays another address');
  }
  const target = addressOf(NAME, tx.target, 'contract address');
  const nativeIn = (() => {
    const chain = chainById(req.from.chainId);
    return Boolean(chain && isNative(chain, req.from.address));
  })();
  return {
    vm: 'evm',
    provider: 'squid',
    chainId: req.from.chainId,
    approval: nativeIn ? null : { token: req.from.address, spender: target, amount: req.amount },
    tx: { to: target, data: hexOf(NAME, tx.data, 'call data'), value: bigOrNull(tx.value) ?? 0n, gas: bigOrNull(tx.gasLimit) },
    minOut: bigOrNull(obj(NAME, route.estimate, 'an estimate').toAmountMin),
    track: {
      kind: 'squid',
      quoteId: strOf(NAME, route.quoteId, 'a quote id'),
      requestId,
      fromChain: String(chainById(req.from.chainId)?.squid ?? req.from.chainId),
      toChain: String(chainById(req.to.chainId)?.squid ?? req.to.chainId),
    },
  };
}

export const squid: SwapProvider = {
  id: 'squid',
  label: NAME,
  supports: (req, ctx) => {
    const from = chainById(req.from.chainId);
    const to = chainById(req.to.chainId);
    return ctx.squid && req.from.chainId !== req.to.chainId && from?.vm === 'evm' && to?.vm === 'evm' && Boolean(from.squid && to.squid);
  },
  async quote(req, _ctx, signal) {
    const { body } = await fetchJson(NAME, `${API_BASE}/api/squid/v2/route`, { method: 'POST', body: routeBody(req, req.sender, false), signal, timeoutMs: 20_000 });
    return parseSquidRoute(body, req.sender, req.recipient ?? req.sender);
  },
  async plan(_quote, req, _ctx, signal) {
    if (!req.sender) throw new ProviderError(NAME, 'needs a connected wallet');
    const { body, headers } = await fetchJson(NAME, `${API_BASE}/api/squid/v2/route`, { method: 'POST', body: routeBody(req, req.sender, true), signal, timeoutMs: 20_000 });
    return squidPlan(body, headers.get('x-request-id'), req);
  },
};
