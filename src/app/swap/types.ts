// Shared shapes for the swap and bridge engine.

export interface Token {
  chainId: number;
  /** EVM native is 0xeeee..., SOL is the wrapped SOL mint. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  /** True when the token is on a curated list (Relay's), false when unknown. */
  verified?: boolean;
}

export interface QuoteRequest {
  from: Token;
  to: Token;
  /** Input amount in the token's smallest unit. */
  amount: bigint;
  /** The wallet that pays. Null before a wallet is connected: quotes are then indicative. */
  sender: string | null;
  /** Where the output goes. Defaults to the sender. Required when the output chain uses another kind of address. */
  recipient: string | null;
  slippageBps: number;
}

export type ProviderId = 'relay' | 'kyberswap' | 'zerox' | 'sushi' | 'jupiter' | 'squid';

/** What the panel knows about the site's keyed providers. */
export interface ProviderContext {
  /** Where Relay calls go: this site's proxy when it holds a key, otherwise Relay itself. */
  relayBase: string;
  zerox: boolean;
  squid: boolean;
}

export interface Quote {
  provider: ProviderId;
  amountOut: bigint;
  /** The least the route pays out after slippage, when the provider says. */
  minOut: bigint | null;
  inUsd: number | null;
  outUsd: number | null;
  /** Network fees the user pays on top, in USD, when known. */
  gasUsd: number | null;
  /** Provider or bridge fees charged on top of the input, in USD, when known. */
  feeUsd: number | null;
  /** Provider fees already taken out of the output, as a note for the user. */
  feeNote: string | null;
  /** Price impact in percent (negative is a loss). */
  impactPct: number | null;
  etaSec: number | null;
  /** DEXes and bridges used, for display. */
  route: string[];
  /** The request this quote answers, so a firm quote can be reused. */
  forSender: string | null;
  forRecipient: string | null;
  raw: unknown;
  at: number;
}

/** Exactly this amount of the input token, approved to exactly this contract. */
export type Approval = { token: string; spender: string; amount: bigint } | null;

export interface EvmTx {
  to: string;
  data: string;
  value: bigint;
  gas: bigint | null;
}

export type Plan =
  | {
      vm: 'evm';
      provider: ProviderId;
      chainId: number;
      approval: Approval;
      tx: EvmTx;
      minOut: bigint | null;
      track: { kind: 'squid'; quoteId: string; requestId: string | null; fromChain: string; toChain: string } | null;
    }
  | { vm: 'svm'; provider: 'jupiter'; transaction: string; requestId: string; minOut: bigint | null }
  | { vm: 'relay'; provider: 'relay'; quote: unknown; minOut: bigint | null };

export interface SwapProvider {
  id: ProviderId;
  label: string;
  /** Can this provider answer this request with this site's setup? */
  supports(req: QuoteRequest, ctx: ProviderContext): boolean;
  quote(req: QuoteRequest, ctx: ProviderContext, signal: AbortSignal): Promise<Quote>;
  /** Turns a quote into what the wallet signs, fetching a firm quote for the real wallet. */
  plan(quote: Quote, req: QuoteRequest, ctx: ProviderContext, signal: AbortSignal): Promise<Plan>;
}
