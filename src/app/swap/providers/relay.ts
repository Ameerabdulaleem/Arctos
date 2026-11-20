// Relay (relay.link): swaps and bridges across EVM chains and Solana in one step.
// Quotes come from Relay's API, either straight from the browser or through this site's
// proxy when the site holds a Relay key. The Relay SDK then runs the steps in the wallet.

import { chainById, isNative, RELAY_EVM_NATIVE, RELAY_SOL_NATIVE } from '../chains';
import { bigOf, bigOrNull, fetchJson, numOrNull, obj, ProviderError } from '../http';
import type { Plan, ProviderContext, Quote, QuoteRequest, SwapProvider, Token } from '../types';

const NAME = 'Relay';
/** Placeholder wallets for indicative quotes, the same ones the Relay SDK uses. */
const EVM_PLACEHOLDER = '0x000000000000000000000000000000000000dead';
const SOL_PLACEHOLDER = 'CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr';
/** A firm quote is reused for signing only while it is this fresh. */
const FIRM_FOR_MS = 20_000;

export function relayCurrency(token: Token): string {
  const chain = chainById(token.chainId);
  if (!chain) throw new ProviderError(NAME, 'does not know this chain');
  if (!isNative(chain, token.address)) return token.address;
  return chain.vm === 'svm' ? RELAY_SOL_NATIVE : RELAY_EVM_NATIVE;
}

function placeholder(chainId: number): string {
  return chainById(chainId)?.vm === 'svm' ? SOL_PLACEHOLDER : EVM_PLACEHOLDER;
}

/** The recipient a request really pays out to. */
export function recipientFor(req: QuoteRequest): string | null {
  if (req.recipient) return req.recipient;
  const sameVm = chainById(req.from.chainId)?.vm === chainById(req.to.chainId)?.vm;
  return sameVm ? req.sender : null;
}

function sameAddress(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  return a.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function parseRelayQuote(body: unknown, req: QuoteRequest, sender: string | null, recipient: string | null): Quote {
  const root = obj(NAME, body, 'a quote');
  if (!Array.isArray(root.steps) || root.steps.length === 0) throw new ProviderError(NAME, 'found no route');
  const details = obj(NAME, root.details, 'quote details');
  const out = obj(NAME, details.currencyOut, 'an output amount');
  const inn = details.currencyIn && typeof details.currencyIn === 'object' ? (details.currencyIn as Record<string, unknown>) : {};
  const fees = root.fees && typeof root.fees === 'object' ? (root.fees as Record<string, Record<string, unknown> | undefined>) : {};
  const impact = details.totalImpact && typeof details.totalImpact === 'object' ? (details.totalImpact as Record<string, unknown>) : {};
  const relayerUsd = numOrNull(fees.relayer?.amountUsd);
  const crossChain = req.from.chainId !== req.to.chainId;
  return {
    provider: 'relay',
    amountOut: bigOf(NAME, out.amount, 'output amount'),
    minOut: bigOrNull(out.minimumAmount),
    inUsd: numOrNull(inn.amountUsd),
    outUsd: numOrNull(out.amountUsd),
    gasUsd: numOrNull(fees.gas?.amountUsd),
    feeUsd: null,
    feeNote: relayerUsd != null && relayerUsd > 0 ? `Relay fee about $${relayerUsd.toFixed(2)}, already in the amount` : null,
    impactPct: numOrNull(impact.percent),
    etaSec: numOrNull(details.timeEstimate),
    route: [crossChain ? 'Relay bridge' : 'Relay'],
    forSender: sender,
    forRecipient: recipient,
    raw: body,
    at: Date.now(),
  };
}

async function requestQuote(req: QuoteRequest, ctx: ProviderContext, signal: AbortSignal, firm: boolean): Promise<Quote> {
  const recipient = recipientFor(req);
  if (firm && (!req.sender || !recipient)) throw new ProviderError(NAME, 'needs the sending wallet and the receiving address');
  const { body } = await fetchJson(NAME, `${ctx.relayBase}/quote/v2`, {
    method: 'POST',
    signal,
    timeoutMs: 15_000,
    body: {
      user: req.sender ?? placeholder(req.from.chainId),
      recipient: recipient ?? placeholder(req.to.chainId),
      originChainId: req.from.chainId,
      destinationChainId: req.to.chainId,
      originCurrency: relayCurrency(req.from),
      destinationCurrency: relayCurrency(req.to),
      amount: req.amount.toString(),
      tradeType: 'EXACT_INPUT',
      slippageTolerance: String(req.slippageBps),
    },
  });
  return parseRelayQuote(body, req, req.sender, recipient);
}

/** Before signing: the quote must pay the right wallet and come from the right one. */
export function checkRelayQuote(raw: unknown, sender: string, recipient: string): void {
  const root = obj(NAME, raw, 'a quote');
  const details = obj(NAME, root.details, 'quote details');
  if (!sameAddress(details.sender, sender)) throw new ProviderError(NAME, 'returned a quote for another wallet');
  if (!sameAddress(details.recipient, recipient)) throw new ProviderError(NAME, 'returned a quote that pays another address');
  for (const step of root.steps as unknown[]) {
    const items = (step as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new ProviderError(NAME, 'sent a step it could not explain');
    for (const item of items) {
      const from = (item as { data?: { from?: unknown } }).data?.from;
      if (from !== undefined && !sameAddress(from, sender)) throw new ProviderError(NAME, 'sent a step for another wallet');
    }
  }
}

export const relay: SwapProvider = {
  id: 'relay',
  label: NAME,
  supports: (req) => Boolean(chainById(req.from.chainId) && chainById(req.to.chainId)),
  quote: (req, ctx, signal) => requestQuote(req, ctx, signal, false),
  async plan(quote, req, ctx, signal): Promise<Plan> {
    const recipient = recipientFor(req);
    if (!req.sender || !recipient) throw new ProviderError(NAME, 'needs the sending wallet and the receiving address');
    const fresh = quote.forSender === req.sender && quote.forRecipient === recipient && Date.now() - quote.at < FIRM_FOR_MS;
    const firm = fresh ? quote : await requestQuote(req, ctx, signal, true);
    checkRelayQuote(firm.raw, req.sender, recipient);
    return { vm: 'relay', provider: 'relay', quote: firm.raw, minOut: firm.minOut };
  },
};
