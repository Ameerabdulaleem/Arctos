// The auto sniper loop. While it is on and the page is open, it scans the launchpad feeds, the
// busiest pools and DexScreener's lists of every chain it covers (Solana and BNB Chain by default)
// every 30 seconds, judges every token with either the
// automatic filter or the user's own filters, and buys the best one that passes, within the
// budget and open position limit. Every scan is logged, with why tokens were skipped.

import { useCallback, useEffect, useRef, useState } from 'react';
import { smartVerdict } from '../../lib/smartSnipe';
import {
  discoverService, judge, passesFilters, sniperService,
  type ChainOption, type FeedToken, type Security, type SniperFilters, type SniperToken,
} from '../../services/sniperService';

export type AutoStrategy = 'smart' | 'filters';

export interface AutoEvent {
  id: number;
  at: number;
  tone: 'buy' | 'sell' | 'skip' | 'info' | 'error';
  text: string;
}

export interface ScanSummary {
  at: number;
  scanned: number;
  passed: number;
  /** Why tokens were skipped, most common first. */
  skipped: Array<[string, number]>;
  best: { symbol: string; points: number } | null;
}

interface Options {
  enabled: boolean;
  strategy: AutoStrategy;
  /** The chains to scan now. Read at each scan, so a chain whose wallet runs dry drops out. */
  chains: () => ChainOption[];
  /** Names the chains covered, for the log, and restarts the loop when they change. */
  scope: string;
  filters: SniperFilters;
  /** Already bought or held, so never bought again. */
  isDone: (id: string) => boolean;
  /** A reason buying is not possible right now (budget, positions, locked wallet), or null. */
  blocked: () => string | null;
  /** Buys the token. Resolves true when it was bought. */
  buy: (token: SniperToken, why: string) => Promise<boolean>;
}

const SCAN_MS = 30_000;
const SECURITY_TTL = 10 * 60_000;
const CHECKS_PER_SCAN = 4;

/** Groups skip reasons, so the log can say "12 already pumped" rather than list them all. */
function category(reason: string): string {
  if (/spike|Late buyers|move has likely happened/.test(reason)) return 'already pumped';
  if (/Falling/.test(reason)) return 'falling right now';
  if (/Liquidity|thin/.test(reason)) return 'thin liquidity';
  if (/bonding curve/.test(reason)) return 'early on its bonding curve';
  if (/Sellers|buys/.test(reason)) return 'sellers in control';
  if (/not checked|checked/.test(reason)) return 'contract not checked';
  if (/Too few trades/.test(reason)) return 'too few trades';
  if (/minutes old/.test(reason)) return 'pool too new';
  if (/Market cap/.test(reason)) return 'market cap too small or thin';
  if (/risk|honeypot|tax|Developer|blocked/i.test(reason)) return 'risky contract or developer';
  if (/strong enough|Score/.test(reason)) return 'not strong enough';
  return 'other';
}

export function useAutoSniper(o: Options) {
  const [events, setEvents] = useState<AutoEvent[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const security = useRef(new Map<string, { at: number; value: Security | null }>());
  const busy = useRef(false);
  const lastBlock = useRef<string | null>(null);
  const seq = useRef(0);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  const log = useCallback((tone: AutoEvent['tone'], text: string) => {
    seq.current += 1;
    const id = seq.current;
    setEvents((list) => [{ id, at: Date.now(), tone, text }, ...list].slice(0, 30));
  }, []);

  const securityOf = useCallback(async (t: SniperToken): Promise<Security | null> => {
    const hit = security.current.get(t.id);
    if (hit && Date.now() - hit.at < SECURITY_TTL) return hit.value;
    const value = await sniperService.security(t.chain, t.address).catch(() => null);
    security.current.set(t.id, { at: Date.now(), value });
    return value;
  }, []);

  const scan = useCallback(async () => {
    const { chains, strategy, filters, isDone, blocked, buy } = opts.current;
    if (busy.current) return;
    const block = blocked();
    if (block) {
      if (lastBlock.current !== block) log('info', `Paused: ${block}`);
      lastBlock.current = block;
      return;
    }
    lastBlock.current = null;
    const scope = chains();
    if (scope.length === 0) return;
    const byKey = new Map(scope.map((c) => [c.key as string, c]));
    busy.current = true;
    setScanning(true);
    try {
      // Every source on every chain at once. Each is cached by the data service, so this is cheap.
      const perChain = await Promise.all(scope.map((chain) => Promise.all([
        sniperService.feed(chain.key, 'all', 'active').then((r) => r.tokens).catch(() => [] as FeedToken[]),
        sniperService.feed(chain.key, 'all', 'new').then((r) => r.tokens).catch(() => [] as FeedToken[]),
        discoverService.list('boosted', chain.key).then((r) => r.tokens).catch(() => []),
        discoverService.list('profiles', chain.key).then((r) => r.tokens).catch(() => []),
        discoverService.list('takeovers', chain.key).then((r) => r.tokens).catch(() => []),
      ])));
      const metas = await discoverService.metas().then((r) => r.metas).catch(() => []);
      const active = perChain.flatMap((c) => c[0]);
      const fresh = perChain.flatMap((c) => c[1]);
      const boosted = perChain.flatMap((c) => c[2]);
      const profiles = perChain.flatMap((c) => c[3]);
      const takeovers = perChain.flatMap((c) => c[4]);
      // The two narratives gaining most in the last hour add their tokens.
      const rising = metas.filter((m) => (m.change1h ?? 0) > 0).sort((a, b) => (b.change1h ?? 0) - (a.change1h ?? 0)).slice(0, 2);
      const metaTokens = (await Promise.all(rising.map((m) => discoverService.meta(m.slug).then((r) => r.tokens).catch(() => [])))).flat();

      const pool = new Map<string, { token: SniperToken; trending: boolean }>();
      for (const t of [...active, ...fresh]) pool.set(t.id, { token: t, trending: false });
      for (const t of [...boosted, ...profiles, ...takeovers, ...metaTokens]) {
        if (!byKey.has(t.chain)) continue;
        const seen = pool.get(t.id);
        pool.set(t.id, { token: seen?.token ?? t, trending: true });
      }
      const candidates = [...pool.values()].filter(({ token }) => !isDone(token.id));
      const skipped = new Map<string, number>();
      const skip = (reason: string) => skipped.set(category(reason), (skipped.get(category(reason)) ?? 0) + 1);
      let winners: Array<{ token: SniperToken; points: number; why: string }> = [];

      if (strategy === 'smart') {
        // Judge with the contract check assumed clean first, then check the best few for real.
        const assumed: Security = { available: true, riskScore: 0, riskLevel: 'low', flags: [], buyTaxPct: 0, sellTaxPct: 0, holders: null, isHoneypot: false, source: 'assumed' };
        const first = candidates
          .map((c) => ({ ...c, v: smartVerdict(c.token, ('security' in c.token && (c.token as FeedToken).security) || security.current.get(c.token.id)?.value || assumed, { trending: c.trending }) }))
          .filter((c) => {
            if (!c.v.ok) skip(c.v.reasons[0]);
            return c.v.ok;
          })
          .sort((a, b) => b.v.points - a.v.points)
          .slice(0, CHECKS_PER_SCAN);
        for (const c of first) {
          const sec = (c.token as FeedToken).security ?? (await securityOf(c.token));
          const v = smartVerdict(c.token, sec, { trending: c.trending });
          if (v.ok) winners.push({ token: c.token, points: v.points, why: v.good.slice(0, 2).join(', ') || `${v.points} points` });
          else skip(v.reasons[0]);
        }
      } else {
        for (const { token } of candidates) {
          if ('score' in token) {
            const v = judge(token as FeedToken, filters, byKey.get(token.chain)?.riskChecks ?? true);
            if (v.ok) winners.push({ token, points: (token as FeedToken).score.total, why: `score ${(token as FeedToken).score.total}` });
            else skip(v.reasons[0]);
          } else if (winners.length < CHECKS_PER_SCAN) {
            const v = passesFilters(token, (await securityOf(token)) ?? undefined, filters);
            if (v.ok) winners.push({ token, points: 50, why: 'passes your filters' });
            else skip(v.reasons[0]);
          }
        }
      }

      winners = winners.sort((a, b) => b.points - a.points);
      const best = winners[0];
      setSummary({
        at: Date.now(),
        scanned: candidates.length,
        passed: winners.length,
        skipped: [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
        best: best ? { symbol: best.token.symbol, points: best.points } : null,
      });
      if (!best) return;
      const ok = await buy(best.token, best.why);
      if (ok) log('buy', `Bought ${best.token.symbol} on ${byKey.get(best.token.chain)?.name ?? best.token.chain}: ${best.why}`);
    } catch (e) {
      log('error', e instanceof Error ? e.message : 'The scan failed.');
    } finally {
      busy.current = false;
      setScanning(false);
    }
  }, [log, securityOf]);

  useEffect(() => {
    if (!o.enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    const loop = async () => {
      if (!live) return;
      if (!document.hidden) await scan();
      if (live) timer = setTimeout(loop, SCAN_MS);
    };
    log('info', `Auto sniping started with ${o.strategy === 'smart' ? 'the automatic filter' : 'your filters'} on ${o.scope}.`);
    void loop();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, o.strategy, o.scope]);

  return { events, summary, scanning, log };
}
