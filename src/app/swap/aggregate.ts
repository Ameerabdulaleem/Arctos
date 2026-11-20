// Asks every provider that can answer, at the same time, and ranks what comes back.
// Also holds the checks every transaction must pass before a wallet is asked to sign it.

import { API_BASE } from '../services/api';
import { chainById, isNative } from './chains';
import { ProviderError } from './http';
import { kyberswap, sushi, zerox, ZEROX_ALLOWANCE_HOLDERS } from './providers/evm';
import { relay } from './providers/relay';
import { jupiter } from './providers/solana';
import { squid } from './providers/squid';
import type { Plan, ProviderContext, ProviderId, Quote, QuoteRequest, SwapProvider, Token } from './types';

export const PROVIDERS: SwapProvider[] = [relay, jupiter, kyberswap, zerox, sushi, squid];

export function providerById(id: ProviderId): SwapProvider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider ${id}`);
  return p;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  relay: 'Relay',
  jupiter: 'Jupiter',
  kyberswap: 'KyberSwap',
  zerox: '0x',
  sushi: 'Sushi',
  squid: 'Squid',
};

const RELAY_DIRECT = 'https://api.relay.link';
let contextCache: { at: number; value: ProviderContext } | null = null;

/** Which keyed providers this site has set up. Falls back to keyless providers only. */
export async function loadProviderContext(signal?: AbortSignal): Promise<ProviderContext> {
  if (contextCache && Date.now() - contextCache.at < 5 * 60_000) return contextCache.value;
  let value: ProviderContext = { relayBase: RELAY_DIRECT, zerox: false, squid: false };
  try {
    const res = await fetch(`${API_BASE}/api/swap/providers`, { signal, credentials: 'same-origin' });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      value = {
        relayBase: body.relayKeyed === true ? `${API_BASE}/api/relay` : RELAY_DIRECT,
        zerox: body.zerox === true,
        squid: body.squid === true,
      };
    }
  } catch {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  }
  contextCache = { at: Date.now(), value };
  return value;
}

export interface QuoteFailure {
  provider: ProviderId;
  message: string;
}

export interface QuoteResult {
  quotes: Quote[];
  failures: QuoteFailure[];
  /** Providers that do not cover this pair, or are not set up on this site. */
  skipped: ProviderId[];
}

/** Asks every provider that covers the request. Slow or failing ones never hold up the rest. */
export async function getQuotes(req: QuoteRequest, ctx: ProviderContext, signal: AbortSignal, onQuote?: (q: Quote) => void): Promise<QuoteResult> {
  const asked = PROVIDERS.filter((p) => p.supports(req, ctx));
  const skipped = PROVIDERS.filter((p) => !asked.includes(p)).map((p) => p.id);
  const settled = await Promise.allSettled(
    asked.map(async (p) => {
      const q = await p.quote(req, ctx, signal);
      if (q.amountOut <= 0n) throw new ProviderError(p.label, 'found no route');
      onQuote?.(q);
      return q;
    }),
  );
  const quotes: Quote[] = [];
  const failures: QuoteFailure[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') quotes.push(s.value);
    else failures.push({ provider: asked[i].id, message: s.reason instanceof ProviderError ? s.reason.message : 'could not answer' });
  });
  return { quotes: rankQuotes(quotes, req), failures, skipped };
}

/** Extra the user pays on top of the input, in USD. */
export function costUsd(q: Quote): number {
  return (q.gasUsd ?? 0) + (q.feeUsd ?? 0);
}

/**
 * Best first. Every quote is for the same output token, so the output amounts compare directly.
 * When a USD price for the output is known, network and bridge costs paid on top are taken off.
 */
export function rankQuotes(quotes: Quote[], req: QuoteRequest): Quote[] {
  const unit = outputUnitUsd(quotes, req.to);
  // A provider that does not report its network fee still pays one. Counting it as zero would
  // favour it unfairly, so it is assumed to cost what the others report.
  const knownGas = quotes.map((q) => q.gasUsd).filter((g): g is number => g != null).sort((a, b) => a - b);
  const typicalGas = knownGas.length ? knownGas[Math.floor(knownGas.length / 2)] : 0;
  const cost = (q: Quote) => (q.gasUsd ?? typicalGas) + (q.feeUsd ?? 0);
  const value = (q: Quote) => (unit != null ? (Number(q.amountOut) / 10 ** req.to.decimals) * unit - cost(q) : null);
  return [...quotes].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va != null && vb != null && va !== vb) return vb - va;
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1;
    return cost(a) - cost(b);
  });
}

/**
 * One USD price per unit of the output token, the median of what the providers say. Every
 * route's output is valued with it, so the dollar figures compare like for like.
 */
export function outputUnitUsd(quotes: Quote[], to: Token): number | null {
  const prices = quotes
    .filter((q) => q.outUsd != null && q.outUsd > 0 && q.amountOut > 0n)
    .map((q) => (q.outUsd as number) / (Number(q.amountOut) / 10 ** to.decimals))
    .sort((a, b) => a - b);
  return prices.length ? prices[Math.floor(prices.length / 2)] : null;
}

/** What a route's output is worth in USD, valued at the shared price. */
export function outputUsd(q: Quote, unit: number | null, to: Token): number | null {
  return unit == null ? null : (Number(q.amountOut) / 10 ** to.decimals) * unit;
}

/** What the output is worth in USD after costs paid on top, used for display. */
export function netUsd(q: Quote, unit: number | null, to: Token): number | null {
  const v = outputUsd(q, unit, to);
  return v == null ? null : v - costUsd(q);
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The last line of defence before a wallet prompt. Refuses any EVM plan that would approve a
 * contract other than the one it calls, approve more than the swap needs, send native coin
 * the swap does not need, or run on another chain.
 */
export function checkEvmPlan(plan: Extract<Plan, { vm: 'evm' }>, req: QuoteRequest): void {
  const chain = chainById(req.from.chainId);
  if (!chain || chain.vm !== 'evm' || plan.chainId !== req.from.chainId) throw new ProviderError(plan.provider, 'built the swap for another chain');
  const to = plan.tx.to;
  if (!ADDRESS.test(to) || /^0x0{40}$/i.test(to)) throw new ProviderError(plan.provider, 'gave no contract to call');
  if (!/^0x([0-9a-fA-F]{2})+$/.test(plan.tx.data)) throw new ProviderError(plan.provider, 'gave no call data');
  if (to.toLowerCase() === req.from.address.toLowerCase()) throw new ProviderError(plan.provider, 'asked to call the token contract directly');
  if (plan.provider === 'zerox' && !ZEROX_ALLOWANCE_HOLDERS.includes(to.toLowerCase())) {
    throw new ProviderError(plan.provider, 'asked to call a contract that is not its AllowanceHolder');
  }
  const native = isNative(chain, req.from.address);
  if (native) {
    if (plan.approval) throw new ProviderError(plan.provider, 'asked for an approval on a native coin');
    if (plan.provider === 'squid') {
      if (plan.tx.value < req.amount) throw new ProviderError(plan.provider, 'sends less than the amount you entered');
    } else if (plan.tx.value !== req.amount) {
      throw new ProviderError(plan.provider, 'sends a different amount than you entered');
    }
  } else {
    const a = plan.approval;
    if (!a) throw new ProviderError(plan.provider, 'did not say which contract to approve');
    if (a.token.toLowerCase() !== req.from.address.toLowerCase()) throw new ProviderError(plan.provider, 'asked to approve another token');
    if (a.spender.toLowerCase() !== to.toLowerCase()) throw new ProviderError(plan.provider, 'asked to approve a contract other than the one it calls');
    if (a.amount !== req.amount) throw new ProviderError(plan.provider, 'asked to approve a different amount');
    // Aggregators take no native coin for a token sale. Squid may add the bridge's gas fee.
    if (plan.provider !== 'squid' && plan.tx.value !== 0n) throw new ProviderError(plan.provider, 'asks for native coin on a token sale');
  }
}

/** Native coin a plan sends beyond the input itself, for example a bridge's gas fee. */
export function extraNative(plan: Extract<Plan, { vm: 'evm' }>, req: QuoteRequest): bigint {
  const chain = chainById(req.from.chainId);
  const native = chain ? isNative(chain, req.from.address) : false;
  return native ? plan.tx.value - req.amount : plan.tx.value;
}
