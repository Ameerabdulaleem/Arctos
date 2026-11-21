// Profit and loss for a wallet from its own trades. Every buy is valued at what was paid at the
// time (SOL at that hour's price, or stablecoins at a dollar); every sell at what came back.
// Cost is averaged per token. Tokens that arrived without a trade (transfers, airdrops) have
// no known cost, so they are counted apart and left out of profit and loss.

import type { WalletTx } from '../swap/solanaHistory';

export const STABLE_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

/** Below this, a dollar leg is rounding noise rather than a trade. */
const DUST_USD = 0.01;

export interface TokenPnl {
  mint: string;
  buys: number;
  sells: number;
  /** Total paid for every buy, in US dollars. */
  investedUsd: number;
  /** Total received from every sell. */
  proceedsUsd: number;
  realizedUsd: number;
  /** Tokens still held that were bought here, and their remaining cost. */
  heldQty: number;
  costUsd: number;
  /** Tokens received without a trade, so with no known cost. */
  untrackedQty: number;
  avgCostUsd: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  unrealizedUsd: number | null;
  totalUsd: number;
  firstAt: number;
  lastAt: number;
}

export interface WalletPnl {
  tokens: TokenPnl[];
  totals: {
    profitUsd: number;
    lossUsd: number;
    netUsd: number;
    realizedUsd: number;
    unrealizedUsd: number;
    trades: number;
    buys: number;
    sells: number;
    swaps: number;
    winRatePct: number | null;
    volumeUsd: number;
    feesUsd: number;
    investedUsd: number;
    since: number | null;
  };
  /** Transactions that were not trades, or could not be valued. */
  skipped: { transfers: number; unpriced: number; complex: number };
}

interface Book {
  t: TokenPnl;
}

const num = (raw: string, decimals: number) => Number(raw) / 10 ** decimals;

/**
 * `solUsdAt` gives SOL's dollar price at a time (null when unknown). `prices` and `holdings`
 * give each token's current price and the amount the wallet holds now, by mint.
 */
export function computePnl(
  txs: WalletTx[],
  solUsdAt: (time: number) => number | null,
  prices: Map<string, number>,
  holdings?: Map<string, number>,
): WalletPnl {
  const books = new Map<string, Book>();
  const book = (mint: string, at: number): TokenPnl => {
    let b = books.get(mint);
    if (!b) {
      b = { t: { mint, buys: 0, sells: 0, investedUsd: 0, proceedsUsd: 0, realizedUsd: 0, heldQty: 0, costUsd: 0, untrackedQty: 0, avgCostUsd: null, priceUsd: null, valueUsd: null, unrealizedUsd: null, totalUsd: 0, firstAt: at, lastAt: at } };
      books.set(mint, b);
    }
    b.t.lastAt = at;
    return b.t;
  };
  const skipped = { transfers: 0, unpriced: 0, complex: 0 };
  let swaps = 0;
  let volume = 0;
  let fees = 0;
  let since: number | null = null;

  /** Takes `qty` out of a token's book: from bought tokens first at average cost, then untracked. */
  const takeOut = (t: TokenPnl, qty: number): { trackedQty: number; cost: number } => {
    const trackedQty = Math.min(qty, t.heldQty);
    const cost = t.heldQty > 0 ? (t.costUsd * trackedQty) / t.heldQty : 0;
    t.heldQty -= trackedQty;
    t.costUsd -= cost;
    t.untrackedQty = Math.max(0, t.untrackedQty - (qty - trackedQty));
    if (t.heldQty < 1e-12) {
      t.heldQty = 0;
      t.costUsd = 0;
    }
    return { trackedQty, cost };
  };

  for (const tx of txs) {
    const solPrice = solUsdAt(tx.time);
    const solMoved = BigInt(tx.sol) !== 0n;
    if (solMoved && solPrice == null) {
      skipped.unpriced += 1;
      continue;
    }
    fees += num(tx.fee, 9) * (solPrice ?? 0);
    // Dollars spent (positive) or received (negative) on the SOL and stablecoin side.
    let quoteUsd = -num(tx.sol, 9) * (solPrice ?? 0);
    const others: WalletTx['tokens'] = [];
    for (const t of tx.tokens) {
      if (STABLE_MINTS[t.mint]) quoteUsd -= num(t.delta, t.decimals);
      else others.push(t);
    }
    const hasQuote = Math.abs(quoteUsd) >= DUST_USD;

    if (others.length === 1) {
      const leg = others[0];
      const qty = Math.abs(num(leg.delta, leg.decimals));
      const t = book(leg.mint, tx.time);
      const bought = BigInt(leg.delta) > 0n;
      if (bought && hasQuote && quoteUsd > 0) {
        t.buys += 1;
        t.investedUsd += quoteUsd;
        t.heldQty += qty;
        t.costUsd += quoteUsd;
        volume += quoteUsd;
        since ??= tx.time;
      } else if (!bought && hasQuote && quoteUsd < 0) {
        const proceeds = -quoteUsd;
        const { trackedQty, cost } = takeOut(t, qty);
        // Only the share that was bought here has a known cost; the rest is not profit or loss.
        const trackedProceeds = qty > 0 ? (proceeds * trackedQty) / qty : 0;
        t.sells += 1;
        t.proceedsUsd += proceeds;
        t.realizedUsd += trackedProceeds - cost;
        volume += proceeds;
        since ??= tx.time;
      } else {
        // Sent or received with nothing paid or received in return.
        skipped.transfers += 1;
        if (bought) t.untrackedQty += qty;
        else takeOut(t, qty);
      }
    } else if (others.length === 2 && !hasQuote && BigInt(others[0].delta) * BigInt(others[1].delta) < 0n) {
      // Token for token: the cost moves from the token given to the token received.
      const out = BigInt(others[0].delta) < 0n ? others[0] : others[1];
      const into = out === others[0] ? others[1] : others[0];
      const outQty = Math.abs(num(out.delta, out.decimals));
      const inQty = num(into.delta, into.decimals);
      const from = book(out.mint, tx.time);
      const to = book(into.mint, tx.time);
      const { trackedQty, cost } = takeOut(from, outQty);
      const share = outQty > 0 ? trackedQty / outQty : 0;
      to.heldQty += inQty * share;
      to.costUsd += cost;
      to.untrackedQty += inQty * (1 - share);
      to.buys += 1;
      from.sells += 1;
      swaps += 1;
      since ??= tx.time;
    } else if (others.length > 0) {
      skipped.complex += 1;
    }
  }

  const tokens: TokenPnl[] = [];
  let realized = 0;
  let unrealized = 0;
  let profit = 0;
  let loss = 0;
  let wins = 0;
  let closed = 0;
  let buys = 0;
  let sells = 0;
  let invested = 0;
  for (const { t } of books.values()) {
    if (t.buys === 0 && t.sells === 0) continue;
    const price = prices.get(t.mint) ?? null;
    const now = holdings?.get(t.mint);
    // The wallet may hold less than the book says, if some left without a trade we saw.
    const held = now != null ? Math.min(t.heldQty, now) : t.heldQty;
    if (held < t.heldQty && t.heldQty > 0) {
      t.costUsd *= held / t.heldQty;
      t.heldQty = held;
    }
    t.avgCostUsd = t.heldQty > 0 ? t.costUsd / t.heldQty : null;
    t.priceUsd = price;
    t.valueUsd = price != null ? t.heldQty * price : null;
    t.unrealizedUsd = t.valueUsd != null ? t.valueUsd - t.costUsd : t.heldQty > 0 ? null : 0;
    t.totalUsd = t.realizedUsd + (t.unrealizedUsd ?? 0);
    tokens.push(t);
    realized += t.realizedUsd;
    unrealized += t.unrealizedUsd ?? 0;
    if (t.totalUsd >= 0) profit += t.totalUsd;
    else loss += t.totalUsd;
    if (t.sells > 0) {
      closed += 1;
      if (t.realizedUsd > 0) wins += 1;
    }
    buys += t.buys;
    sells += t.sells;
    invested += t.investedUsd;
  }
  tokens.sort((a, b) => Math.abs(b.totalUsd) - Math.abs(a.totalUsd));
  return {
    tokens,
    totals: {
      profitUsd: profit,
      lossUsd: loss,
      netUsd: profit + loss,
      realizedUsd: realized,
      unrealizedUsd: unrealized,
      trades: buys + sells - swaps,
      buys,
      sells,
      swaps,
      winRatePct: closed ? (wins / closed) * 100 : null,
      volumeUsd: volume,
      feesUsd: fees,
      investedUsd: invested,
      since,
    },
    skipped,
  };
}
