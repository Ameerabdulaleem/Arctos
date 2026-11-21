// The sniper's automatic filter: picks tokens with real liquidity, buyers in control, a clean
// contract and healthy momentum, and refuses tokens that already pumped hard (buying the top of a
// spike is how most snipes lose) or are dumping. No filter can promise a win; this one avoids the
// most common ways to lose and ranks what is left.

import type { FeedToken, Security, SniperToken } from '../services/sniperService';

export interface SmartVerdict {
  ok: boolean;
  /** 0 to 100, higher is better. Only meaningful when ok. */
  points: number;
  /** Why it was refused, most important first. */
  reasons: string[];
  /** What it liked. */
  good: string[];
}

export interface ChaseCheck {
  /** Bought now, the token would likely be the exit for earlier buyers. */
  chasing: boolean;
  /** Falling hard right now. */
  dumping: boolean;
  note: string | null;
}

/** The lowest points a token needs to be bought automatically. */
export const SMART_MIN_POINTS = 40;

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;

/**
 * Whether buying now means chasing a spike or catching a falling knife. Used by the automatic
 * filter and shown on every card.
 */
export function chaseCheck(t: Pick<SniperToken, 'change5m' | 'change1h' | 'change24h'>): ChaseCheck {
  const m5 = t.change5m ?? 0;
  const h1 = t.change1h ?? 0;
  const h24 = t.change24h ?? 0;
  if (m5 >= 20) return { chasing: true, dumping: false, note: `Already ${pct(m5)} in 5 minutes. Buying the top of a spike usually ends in the dump that follows.` };
  if (h1 >= 60) return { chasing: true, dumping: false, note: `Already ${pct(h1)} in the last hour. Late buyers are often the exit for early ones.` };
  if (h24 >= 400 && h1 > 0) return { chasing: true, dumping: false, note: `Already ${pct(h24)} today. Most of the move has likely happened.` };
  if (h1 <= -15 || m5 <= -8) return { chasing: false, dumping: true, note: `Falling right now (${pct(m5)} in 5 minutes, ${pct(h1)} in an hour).` };
  return { chasing: false, dumping: false, note: null };
}

function isFeed(t: SniperToken): t is FeedToken {
  return 'score' in t && typeof (t as FeedToken).score === 'object';
}

/** Share of trades that are buys, from the best data the token has. */
function buyShare(t: SniperToken): { pct: number | null; trades: number } {
  if (isFeed(t)) {
    const flow = t.flow1h.buys + t.flow1h.sells >= 30 ? t.flow1h : t.flow24h;
    const trades = flow.buys + flow.sells;
    return { pct: t.buyRatioPct ?? (trades ? (flow.buys / trades) * 100 : null), trades };
  }
  const trades = t.buys24h + t.sells24h;
  return { pct: trades ? (t.buys24h / trades) * 100 : null, trades };
}

export interface SmartOptions {
  now?: number;
  /** The token is on one of DexScreener's attention lists (boosted, profiles, takeovers, metas). */
  trending?: boolean;
}

/** The automatic filter's verdict on one token. `security` is the contract check, when known. */
export function smartVerdict(t: SniperToken, security: Security | null | undefined, opts: SmartOptions = {}): SmartVerdict {
  const now = opts.now ?? Date.now();
  const reasons: string[] = [];
  const good: string[] = [];
  const feed = isFeed(t) ? t : null;
  const onCurve = feed?.onCurve ?? false;

  // Hard stops first.
  if (!(t.priceUsd > 0)) reasons.push('No live price');
  if (feed?.score.blocked) reasons.push(feed.score.warnings[0] ?? 'A serious risk was found');
  const sec = security ?? feed?.security ?? null;
  if (sec?.available) {
    if (sec.isHoneypot) reasons.push('Flagged as a honeypot');
    if (sec.riskScore > 40) reasons.push(`Contract risk score ${sec.riskScore} is too high`);
    if (Math.max(sec.buyTaxPct ?? 0, sec.sellTaxPct ?? 0) > 10) reasons.push('Trade tax above 10%');
  } else if (!(onCurve && feed?.score.checked)) {
    // No contract data yet: only a deep pool that has traded for hours is trusted without it.
    const ageH = t.createdAt ? (now - t.createdAt) / 3600_000 : 0;
    if (onCurve || t.liquidityUsd < 75_000 || ageH < 3) reasons.push('Contract not checked yet');
    else good.push('No contract data, but a deep pool trading for hours');
  }
  if (feed?.developer?.holdingPct != null && feed.developer.holdingPct > 15) reasons.push(`Developer still holds ${feed.developer.holdingPct.toFixed(0)}%`);
  if (feed?.developer?.verdict === 'poor') reasons.push('Developer has a poor record');

  if (onCurve) {
    const progress = feed?.graduation?.percent ?? 0;
    if (progress < 25) reasons.push(`Only ${progress.toFixed(0)}% along its bonding curve`);
    if (t.marketCapUsd < 15_000) reasons.push('Market cap under $15k');
  } else {
    if (t.liquidityUsd < 20_000) reasons.push('Liquidity under $20k, too thin to sell into');
    if (t.marketCapUsd < 50_000) reasons.push('Market cap under $50k');
    if (t.liquidityUsd > 0 && t.marketCapUsd / t.liquidityUsd > 40) reasons.push('Market cap is over 40 times the liquidity, easy to dump on');
    const ageMin = t.createdAt ? (now - t.createdAt) / 60_000 : null;
    if (ageMin != null && ageMin < 20) reasons.push('Pool is under 20 minutes old');
  }

  const share = buyShare(t);
  if (share.trades < (onCurve ? 30 : 150)) reasons.push('Too few trades to trust');
  if (share.pct == null || share.pct < 52) reasons.push(`Sellers in control (${share.pct == null ? 'no' : share.pct.toFixed(0) + '%'} buys)`);

  const chase = chaseCheck(t);
  if (chase.note && (chase.chasing || chase.dumping)) reasons.push(chase.note);

  // Points for what is left.
  let points = 0;
  if (share.pct != null) {
    const p = Math.min(25, Math.max(0, ((share.pct - 52) / 23) * 25));
    points += p;
    if (share.pct >= 60) good.push(`${share.pct.toFixed(0)}% of trades are buys`);
  }
  const h1 = t.change1h ?? 0;
  if (h1 >= 3 && h1 <= 35) {
    points += 20 - Math.abs(h1 - 15) * 0.6;
    good.push(`Steady climb, ${pct(h1)} in an hour`);
  } else if (h1 > -5 && h1 < 3) {
    points += 6;
  }
  const m5 = t.change5m ?? 0;
  if (m5 >= 0 && m5 <= 8) points += 10;
  if (!onCurve && t.liquidityUsd >= 20_000) {
    points += Math.min(15, (Math.log10(t.liquidityUsd / 20_000) / Math.log10(25)) * 15);
    if (t.liquidityUsd >= 100_000) good.push('Deep liquidity');
  }
  if (onCurve) points += Math.min(15, ((feed?.graduation?.percent ?? 0) / 100) * 15);
  const turnover = t.liquidityUsd > 0 ? t.volume24hUsd / t.liquidityUsd : 0;
  if (turnover >= 1 && turnover <= 15) points += 10;
  if (sec?.available && sec.riskScore <= 10) {
    points += 10;
    good.push('Clean contract check');
  } else if (sec?.available && sec.riskScore <= 25) {
    points += 5;
  }
  if (feed?.score.checked) points += Math.min(10, feed.score.total / 10);
  if (opts.trending) {
    points += 5;
    good.push('Getting attention on DexScreener');
  }

  points = Math.round(Math.max(0, Math.min(100, points)));
  if (reasons.length === 0 && points < SMART_MIN_POINTS) reasons.push(`Not strong enough yet (${points} of ${SMART_MIN_POINTS} points)`);
  return { ok: reasons.length === 0, points, reasons, good };
}
