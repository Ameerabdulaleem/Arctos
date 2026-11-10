import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Play, Pause, Plus, Search, ShieldAlert, ShieldCheck, ShieldQuestion, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, Empty, ErrorNotice, Loading, PaperBadge, Pill } from './ui/common';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { errorMessage, openSocket } from '../services/api';
import {
  DEFAULT_FILTERS, SNIPER_CHAINS, chainLabel, passesFilters, sniperService,
  type Security, type SniperChain, type SniperFilters, type SniperToken,
} from '../services/sniperService';
import { formatCompactUsd, formatNumber, formatPct, formatPrice, formatUsd, pnlClass, safeHref, timeAgo } from '../lib/format';

const FILTERS_KEY = 'arctos_sniper_filters';
const TRACKED_KEY = 'arctos_sniper_tracked';
const AUTO_KEY = 'arctos_sniper_auto_done';
const MAX_AUTO_POSITIONS = 5;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function loadFilters(): SniperFilters {
  const stored = readJson<Partial<SniperFilters>>(FILTERS_KEY, {});
  const out = { ...DEFAULT_FILTERS };
  for (const k of Object.keys(out) as Array<keyof SniperFilters>) {
    const v = stored[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

const FIELDS: Array<{ key: keyof SniperFilters; label: string; help: string; max: number }> = [
  { key: 'minLiquidityUsd', label: 'Min liquidity ($)', help: 'Skip pools with less liquidity than this.', max: 1e9 },
  { key: 'maxRiskScore', label: 'Max risk score (0 to 100)', help: 'From the contract risk check. Lower is safer.', max: 100 },
  { key: 'maxTaxPct', label: 'Max buy or sell tax (%)', help: 'Reject tokens that tax trades above this.', max: 100 },
  { key: 'maxPositionUsd', label: 'Position size ($)', help: 'Paper money spent per snipe.', max: 1e7 },
  { key: 'takeProfitPct', label: 'Take profit (%)', help: 'Sell automatically at this gain. 0 turns it off.', max: 100000 },
  { key: 'stopLossPct', label: 'Stop loss (%)', help: 'Sell automatically at this loss. 0 turns it off.', max: 100 },
];

function RiskBadge({ security }: { security: Security | 'loading' | undefined }) {
  if (!security || security === 'loading') {
    return <Pill tone="zinc"><Loader2 className="w-3 h-3 animate-spin" aria-hidden />Checking risk</Pill>;
  }
  if (!security.available) return <Pill tone="zinc"><ShieldQuestion className="w-3 h-3" aria-hidden />No risk data</Pill>;
  if (security.riskLevel === 'low') return <Pill tone="green"><ShieldCheck className="w-3 h-3" aria-hidden />Low risk {security.riskScore}</Pill>;
  if (security.riskLevel === 'medium') return <Pill tone="amber"><ShieldAlert className="w-3 h-3" aria-hidden />Medium risk {security.riskScore}</Pill>;
  return <Pill tone="red"><ShieldAlert className="w-3 h-3" aria-hidden />High risk {security.riskScore}</Pill>;
}

function TokenCard({ token, security, filters, held, onSnipe, onTrack, tracked }: {
  token: SniperToken; security: Security | 'loading' | undefined; filters: SniperFilters; held: boolean;
  onSnipe: (t: SniperToken) => void; onTrack?: (t: SniperToken) => void; tracked?: boolean;
}) {
  const sec = security && security !== 'loading' ? security : undefined;
  const verdict = passesFilters(token, sec, filters);
  const link = safeHref(token.url);
  return (
    <article className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50 hover:border-zinc-600/70 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-white font-bold text-lg truncate max-w-[10rem]">{token.symbol}</h3>
            <Pill tone="zinc">{chainLabel(token.chain)}</Pill>
            <RiskBadge security={security} />
            {held && <Pill tone="blue">Holding</Pill>}
          </div>
          <p className="text-zinc-400 text-sm truncate">{token.name}</p>
          <p className="text-zinc-600 text-xs mt-0.5">{token.createdAt ? `Pool created ${timeAgo(token.createdAt)}` : 'Pool age unknown'}{token.dex ? ` on ${token.dex}` : ''}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-white font-bold tabular-nums">{formatPrice(token.priceUsd)}</p>
          <p className={`text-sm tabular-nums ${pnlClass(token.change24h)}`}>{formatPct(token.change24h)} 24h</p>
          <p className="text-xs text-zinc-500 tabular-nums">{formatPct(token.change5m)} 5m &middot; {formatPct(token.change1h)} 1h</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
        {[
          ['Liquidity', formatCompactUsd(token.liquidityUsd)], ['Market cap', formatCompactUsd(token.marketCapUsd)],
          ['Volume 24h', formatCompactUsd(token.volume24hUsd)], ['Buys / sells', `${token.buys24h} / ${token.sells24h}`],
        ].map(([k, v]) => (
          <div key={k} className="bg-zinc-800/50 rounded-lg px-3 py-2"><dt className="text-zinc-500 text-[10px] uppercase tracking-wider">{k}</dt><dd className="text-white font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>

      {sec && sec.available && (
        <p className="text-xs text-zinc-400 mb-2">
          Buy tax {sec.buyTaxPct == null ? 'unknown' : `${sec.buyTaxPct}%`}, sell tax {sec.sellTaxPct == null ? 'unknown' : `${sec.sellTaxPct}%`}
          {sec.holders != null && `, ${formatNumber(sec.holders, 0)} holders`}
        </p>
      )}
      {sec && sec.flags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-3">
          {sec.flags.slice(0, 5).map((f) => <li key={f} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/15">{f}</li>)}
        </ul>
      )}
      {!verdict.ok && security !== 'loading' && <p className="text-xs text-zinc-500 mb-3">Does not match your filters: {verdict.reasons.join('; ')}.</p>}

      <div className="flex gap-2">
        <button onClick={() => onSnipe(token)} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
          <Target className="w-4 h-4" aria-hidden /> Paper snipe {formatUsd(filters.maxPositionUsd, 0)}
        </button>
        {onTrack && !tracked && (
          <button onClick={() => onTrack(token)} className="px-3 py-2.5 bg-zinc-700/50 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm border border-zinc-700/50" aria-label={`Track ${token.symbol}`}><Plus className="w-4 h-4" /></button>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="px-3 py-2.5 bg-zinc-700/50 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm border border-zinc-700/50 inline-flex items-center" aria-label={`Open ${token.symbol} on DexScreener`}>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </article>
  );
}

export function SniperPanel() {
  const paper = usePaper();
  const [filters, setFilters] = useState<SniperFilters>(loadFilters);
  const [chain, setChain] = useState<SniperChain>('solana');
  const [tab, setTab] = useState<'new' | 'tracked'>('new');
  const [auto, setAuto] = useState(false);
  const [tracked, setTracked] = useState<SniperToken[]>(() => readJson<SniperToken[]>(TRACKED_KEY, []).filter((t) => t && typeof t.id === 'string'));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SniperToken[]>([]);
  const [live, setLive] = useState<Record<string, SniperToken>>({});
  const [security, setSecurity] = useState<Record<string, Security | 'loading'>>({});
  const requested = useRef(new Set<string>());
  const autoDone = useRef(new Set<string>(readJson<string[]>(AUTO_KEY, [])));

  const feed = usePolling((s) => sniperService.newPairs(chain, s), 30_000, [chain]);
  const trackedIds = useMemo(() => tracked.map((t) => t.id), [tracked]);
  const trackedLive = usePolling((s) => sniperService.refresh(trackedIds, s), trackedIds.length ? 12_000 : null, [trackedIds.join(',')]);

  // Pairs pushed by the server appear immediately without waiting for the next poll.
  useEffect(() => {
    return openSocket('/ws/sniper', (msg) => {
      const m = msg as { type?: string; chain?: string; tokens?: SniperToken[] };
      if (m.type !== 'new_pairs' || !Array.isArray(m.tokens)) return;
      setLive((prev) => {
        const next = { ...prev };
        for (const t of m.tokens ?? []) next[t.id] = t;
        return next;
      });
    });
  }, []);

  const newTokens = useMemo(() => {
    const byId = new Map<string, SniperToken>();
    for (const t of Object.values(live)) if (t.chain === chain) byId.set(t.id, t);
    for (const t of feed.data?.tokens ?? []) byId.set(t.id, t);
    return [...byId.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 30);
  }, [live, feed.data, chain]);

  const trackedTokens = useMemo(() => {
    const fresh = new Map((trackedLive.data ?? []).map((t) => [t.id, t]));
    return tracked.map((t) => fresh.get(t.id) ?? t);
  }, [tracked, trackedLive.data]);

  useEffect(() => writeJson(FILTERS_KEY, filters), [filters]);
  useEffect(() => writeJson(TRACKED_KEY, tracked), [tracked]);

  // Contract risk checks for what is on screen, at most a few at a time.
  const visible = tab === 'new' ? newTokens.slice(0, 15) : trackedTokens;
  useEffect(() => {
    const todo = visible.filter((t) => !requested.current.has(t.id)).slice(0, 4);
    for (const t of todo) {
      requested.current.add(t.id);
      setSecurity((prev) => ({ ...prev, [t.id]: 'loading' }));
      sniperService
        .security(t.chain, t.address)
        .then((s) => setSecurity((prev) => ({ ...prev, [t.id]: s })))
        .catch(() => {
          requested.current.delete(t.id);
          setSecurity((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== t.id)));
        });
    }
  }, [visible]);

  const sniperPositions = paper.positions.filter((p) => p.source === 'sniper');

  const snipe = useCallback(
    (token: SniperToken, automatic = false) => {
      if (!token.priceUsd || token.priceUsd <= 0) return toast.error('No live price for this token.');
      const sec = security[token.id];
      if (!automatic && sec && sec !== 'loading' && sec.isHoneypot) {
        toast.warning('This token is flagged as a honeypot. Paper trade only.');
      }
      const spend = Math.min(filters.maxPositionUsd, paper.availableCash);
      const qty = spend / (token.priceUsd * 1.001);
      const r = paper.buyMarket({ key: token.id, symbol: token.symbol, label: token.name, source: 'sniper' }, qty, token.priceUsd, {
        takeProfitPct: filters.takeProfitPct || undefined,
        stopLossPct: filters.stopLossPct || undefined,
        note: automatic ? 'Auto snipe' : 'Paper snipe',
      });
      if (!r.ok) return toast.error(r.error);
      toast.success(`${automatic ? 'Auto sniped' : 'Sniped'} ${token.symbol}`, { description: `${formatUsd(spend)} of paper money at ${formatPrice(token.priceUsd)}.` });
    },
    [filters, paper, security],
  );

  // Auto mode: buy tokens from the live feed that pass every filter. Runs only while this page is open.
  useEffect(() => {
    if (!auto) return;
    for (const t of newTokens) {
      if (autoDone.current.has(t.id) || paper.account.positions[t.id]) continue;
      const sec = security[t.id];
      if (!sec || sec === 'loading') continue;
      if (sniperPositions.length >= MAX_AUTO_POSITIONS) break;
      if (!passesFilters(t, sec, filters).ok) continue;
      autoDone.current.add(t.id);
      writeJson(AUTO_KEY, [...autoDone.current].slice(-300));
      snipe(t, true);
      break; // one at a time so cash checks stay accurate
    }
  }, [auto, newTokens, security, filters, paper.account.positions, sniperPositions.length, snipe]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return toast.error('Enter a token name, symbol or contract address.');
    setSearching(true);
    try {
      const found = await sniperService.search(q, chain);
      setResults(found);
      if (found.length === 0) toast.info(`Nothing found on ${chainLabel(chain)}.`);
    } catch (e) {
      toast.error(errorMessage(e, 'Search failed.'));
    } finally {
      setSearching(false);
    }
  };

  const track = (t: SniperToken) => {
    setTracked((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev].slice(0, 30)));
    toast.success(`Tracking ${t.symbol}`);
    setTab('tracked');
  };

  const setFilter = (key: keyof SniperFilters, raw: string, max: number) => {
    const n = Number(raw);
    setFilters((prev) => ({ ...prev, [key]: Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : prev[key] }));
  };

  const matching = newTokens.filter((t) => {
    const s = security[t.id];
    return s && s !== 'loading' && passesFilters(t, s, filters).ok;
  }).length;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1500px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center"><Target className="w-5 h-5 text-white" aria-hidden /></span>
            Sniper Engine <PaperBadge />
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Fresh liquidity pools with contract risk checks. Snipes are simulated at the live price.</p>
        </div>
        <button
          onClick={() => setAuto((a) => !a)} aria-pressed={auto}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm border ${auto ? 'bg-green-600 hover:bg-green-700 text-white border-transparent' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'}`}
        >
          {auto ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
          {auto ? 'Auto sniping on' : 'Start auto sniping'}
        </button>
      </div>
      {auto && <p role="status" className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">Auto mode buys tokens that pass your filters, up to {MAX_AUTO_POSITIONS} open positions. It only runs while this page is open.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-white font-semibold mb-4">Filters</h2>
            <div className="space-y-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-zinc-300 text-xs font-medium tracking-wide">{f.label}</span>
                  <span className="block text-[11px] text-zinc-500 mb-1.5">{f.help}</span>
                  <input type="number" inputMode="decimal" min={0} max={f.max} step="any" value={filters[f.key]} onChange={(e) => setFilter(f.key, e.target.value, f.max)}
                    className="w-full bg-zinc-800/60 text-white px-3 py-2 rounded-lg border border-zinc-700/50 focus:border-blue-500/60 focus:outline-none text-sm tabular-nums" />
                </label>
              ))}
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs text-zinc-400 hover:text-white">Reset to defaults</button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-white font-semibold mb-3">Snapshot</h2>
            <dl className="space-y-2 text-sm">
              {[
                ['New pools loaded', String(newTokens.length)], ['Passing your filters', String(matching)],
                ['Open snipes', String(sniperPositions.length)], ['Paper cash', formatUsd(paper.availableCash)],
              ].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-zinc-500">{k}</dt><dd className="text-white font-semibold tabular-nums">{v}</dd></div>)}
            </dl>
          </Card>

          {sniperPositions.length > 0 && (
            <Card className="p-5">
              <h2 className="text-white font-semibold mb-3">Open snipes</h2>
              <ul className="space-y-3">
                {sniperPositions.map((p) => (
                  <li key={p.key} className="text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-white font-medium">{p.symbol}</span>
                      <span className={`tabular-nums ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPct == null ? 'Waiting for price' : formatPct(p.unrealizedPct)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-zinc-500">
                      <span>{formatUsd(p.value)}</span>
                      <button
                        onClick={() => {
                          if (!p.price) return toast.error('No live price yet.');
                          const r = paper.sellMarket(p.key, p.qty, p.price);
                          if (!r.ok) toast.error(r.error);
                          else toast.success(`Sold ${p.symbol}`);
                        }}
                        className="text-red-400 hover:text-red-300"
                      >Sell all</button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-2 p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div role="tablist" aria-label="Token lists" className="flex gap-1 bg-zinc-800/60 rounded-lg p-1">
              {([['new', 'New pools'], ['tracked', `Tracked (${tracked.length})`]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-md text-sm ${tab === id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
            <label className="sr-only" htmlFor="sniper-chain">Chain</label>
            <select id="sniper-chain" value={chain} onChange={(e) => { setChain(e.target.value as SniperChain); setResults([]); }} className="bg-zinc-800 text-zinc-200 px-3 py-2 rounded-lg border border-zinc-700 text-sm">
              {SNIPER_CHAINS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <form onSubmit={(e) => { e.preventDefault(); void runSearch(); }} className="flex flex-1 min-w-[220px] gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                <label className="sr-only" htmlFor="sniper-search">Search tokens</label>
                <input id="sniper-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${chainLabel(chain)} by name, symbol or address`}
                  className="w-full bg-zinc-800 text-zinc-100 pl-9 pr-3 py-2 rounded-lg border border-zinc-700 text-sm" maxLength={64} />
              </div>
              <button type="submit" disabled={searching} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 text-white rounded-lg text-sm">{searching ? 'Searching...' : 'Search'}</button>
            </form>
          </div>

          {results.length > 0 && (
            <div className="mb-5 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
              <div className="flex justify-between items-center mb-2"><p className="text-sm text-blue-200 font-medium">Search results</p><button onClick={() => setResults([])} aria-label="Close results" className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button></div>
              <div className="space-y-3">
                {results.map((t) => <TokenCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} />)}
              </div>
            </div>
          )}

          {tab === 'new' ? (
            feed.loading && !feed.data ? <Loading label="Scanning for new pools" />
            : feed.error && newTokens.length === 0 ? <ErrorNotice message={feed.error} onRetry={feed.refresh} />
            : newTokens.length === 0 ? <Empty title={`No new pools on ${chainLabel(chain)} yet`}>New launches show up here as soon as they are indexed.</Empty>
            : <div className="space-y-3">{newTokens.map((t) => <TokenCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} />)}</div>
          ) : trackedTokens.length === 0 ? (
            <Empty title="You are not tracking any tokens">Search for a token and press the plus button to follow its live price here.</Empty>
          ) : (
            <div className="space-y-3">
              {trackedTokens.map((t) => (
                <div key={t.id} className="relative">
                  <TokenCard token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} tracked />
                  <button onClick={() => setTracked((prev) => prev.filter((x) => x.id !== t.id))} className="absolute top-3 right-3 text-[11px] text-zinc-500 hover:text-red-400">Stop tracking</button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-5 text-[11px] text-zinc-500">Pools from GeckoTerminal and DexScreener. Risk checks from GoPlus. Automated checks can miss problems, and new tokens are often scams.</p>
        </Card>
      </div>
    </div>
  );
}
