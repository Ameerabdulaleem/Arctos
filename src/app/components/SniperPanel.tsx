import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowSquareOut, ChartBar, CheckCircle, CircleNotch, Crosshair, FunnelSimple, GraduationCap, MagnifyingGlass, Pause, Play, Plus,
  Shield, ShieldCheck, ShieldWarning, Trophy, UserCircle, Warning, X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Card, Empty, ErrorNotice, IconTile, Loading, PageHeader, PaperBadge, Pill } from './ui/common';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { errorMessage } from '../services/api';
import {
  DEFAULT_FILTERS, FALLBACK_CHAINS, chainLabel, judge, passesFilters, snipeRecord, sniperService,
  type ChainOption, type FeedToken, type FeedView, type Security, type SniperFilters, type SniperToken,
} from '../services/sniperService';
import { formatCompactUsd, formatNumber, formatPct, formatPrice, formatUsd, pnlClass, safeHref, shortAddress, timeAgo } from '../lib/format';

const FILTERS_KEY = 'arctos_sniper_filters_v2';
const TRACKED_KEY = 'arctos_sniper_tracked';
const AUTO_KEY = 'arctos_sniper_auto_done';
const CHAIN_KEY = 'arctos_sniper_chain';
const MAX_AUTO_POSITIONS = 5;
const NO_RISK_DATA: Security = { available: false, riskScore: 0, riskLevel: 'unknown', flags: [], buyTaxPct: null, sellTaxPct: null, holders: null, isHoneypot: null, source: 'GoPlus' };

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

const FIELD_GROUPS: Array<{ title: string; fields: Array<{ key: keyof SniperFilters; label: string; help: string; max: number }> }> = [
  {
    title: 'Selection',
    fields: [
      { key: 'minScore', label: 'Min snipe score (0 to 100)', help: 'Only tokens rated at least this high are bought.', max: 100 },
      { key: 'minBuyRatioPct', label: 'Min share of buys (%)', help: 'Recent trades must be at least this much buying.', max: 100 },
      { key: 'minDevSuccessPct', label: 'Min developer success rate (%)', help: '0 also accepts developers with no record yet.', max: 100 },
      { key: 'maxDevHoldingPct', label: 'Max developer holding (%)', help: 'Skip tokens where the developer holds more.', max: 100 },
    ],
  },
  {
    title: 'Safety',
    fields: [
      { key: 'minLiquidityUsd', label: 'Min liquidity ($)', help: 'Skip pools with less liquidity. Not applied on a bonding curve.', max: 1e9 },
      { key: 'maxRiskScore', label: 'Max contract risk (0 to 100)', help: 'From the contract risk check. Lower is safer.', max: 100 },
      { key: 'maxTaxPct', label: 'Max buy or sell tax (%)', help: 'Reject tokens that tax trades above this.', max: 100 },
    ],
  },
  {
    title: 'Position',
    fields: [
      { key: 'maxPositionUsd', label: 'Position size ($)', help: 'Paper money spent per snipe.', max: 1e7 },
      { key: 'takeProfitPct', label: 'Take profit (%)', help: 'Sell automatically at this gain. 0 turns it off.', max: 100000 },
      { key: 'stopLossPct', label: 'Stop loss (%)', help: 'Sell automatically at this loss. 0 turns it off.', max: 100 },
    ],
  },
];

const GRADE_COLOR: Record<string, string> = { A: '#34d399', B: '#75dcff', C: '#fbbf24', D: '#fb923c', F: '#fb7185' };

/** The snipe score as a ring, with the grade in the middle. */
function ScoreRing({ total, grade, checked }: { total: number; grade: string; checked: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const color = checked ? GRADE_COLOR[grade] ?? '#8593AC' : '#8593AC';
  return (
    <div className="relative h-14 w-14 shrink-0" role="img" aria-label={`Snipe score ${total} out of 100, grade ${grade}${checked ? '' : ', not fully checked yet'}`}>
      <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(total / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="num text-[15px] font-semibold text-white">{total}</span>
        <span className="text-[9px] font-semibold" style={{ color }}>{checked ? grade : '...'}</span>
      </span>
    </div>
  );
}

function RiskBadge({ security }: { security: Security | 'loading' | null | undefined }) {
  if (security === 'loading') return <Pill tone="zinc"><CircleNotch className="h-3 w-3 animate-spin" aria-hidden />Checking risk</Pill>;
  if (!security || !security.available) return <Pill tone="zinc"><Shield className="h-3 w-3" aria-hidden />No risk data</Pill>;
  if (security.riskLevel === 'low') return <Pill tone="green"><ShieldCheck className="h-3 w-3" aria-hidden />Low risk {security.riskScore}</Pill>;
  if (security.riskLevel === 'medium') return <Pill tone="amber"><ShieldWarning className="h-3 w-3" aria-hidden />Medium risk {security.riskScore}</Pill>;
  return <Pill tone="red"><ShieldWarning className="h-3 w-3" aria-hidden />High risk {security.riskScore}</Pill>;
}

function DeveloperLine({ token }: { token: FeedToken }) {
  const dev = token.developer;
  if (!token.score.checked) return <p className="text-xs text-zinc-500">Developer and contract are still being checked.</p>;
  if (!dev) return <p className="text-xs text-zinc-500">Developer wallet could not be identified.</p>;
  const { record } = dev;
  const tone = dev.verdict === 'proven' ? 'green' : dev.verdict === 'poor' ? 'red' : dev.verdict === 'mixed' ? 'amber' : 'zinc';
  const label = dev.verdict === 'proven' ? 'Proven developer' : dev.verdict === 'poor' ? 'Poor record' : dev.verdict === 'mixed' ? 'Mixed record' : 'No record yet';
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400">
      <Pill tone={tone}><UserCircle className="h-3 w-3" aria-hidden />{label}</Pill>
      <span>
        {record.launchesSeen === 0
          ? 'First launch we have seen from this wallet'
          : `${record.successes} of ${record.launchesSeen} earlier ${record.launchesSeen === 1 ? 'launch' : 'launches'} succeeded${record.successRate != null ? ` (${record.successRate.toFixed(0)}%)` : ''}`}
      </span>
      {dev.holdingPct != null && <span>Holds {dev.holdingPct.toFixed(1)}%</span>}
      <span className="num text-zinc-600" title={dev.address}>{shortAddress(dev.address)}</span>
    </div>
  );
}

function FeedCard({ token, filters, riskChecks, held, tracked, onSnipe, onTrack }: {
  token: FeedToken; filters: SniperFilters; riskChecks: boolean; held: boolean; tracked: boolean;
  onSnipe: (t: SniperToken) => void; onTrack: (t: SniperToken) => void;
}) {
  const verdict = judge(token, filters, riskChecks);
  const link = safeHref(token.url);
  const flow = token.flow1h.buys + token.flow1h.sells >= 10 ? token.flow1h : token.flow24h;
  const flowLabel = flow === token.flow1h ? 'last hour' : 'last 24h';
  const buyPct = token.buyRatioPct;
  return (
    <article className={`panel-inset p-4 transition ${verdict.ok ? 'border-emerald-300/30 bg-emerald-400/[0.04]' : ''}`}>
      <div className="flex items-start gap-3.5">
        <ScoreRing total={token.score.total} grade={token.score.grade} checked={token.score.checked} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="max-w-[11rem] truncate text-lg font-semibold text-white">{token.symbol}</h3>
            {token.launchpad && <Pill tone="violet">{token.launchpad}</Pill>}
            <RiskBadge security={token.score.checked ? token.security : 'loading'} />
            {verdict.ok && <Pill tone="green"><CheckCircle className="h-3 w-3" weight="fill" aria-hidden />Passes your filters</Pill>}
            {held && <Pill tone="blue">Holding</Pill>}
          </div>
          <p className="truncate text-sm text-zinc-400">{token.name}</p>
          <p className="mt-0.5 text-xs text-zinc-600">{token.createdAt ? `Pool created ${timeAgo(token.createdAt)}` : 'Pool age unknown'}{!token.launchpad && token.dex ? ` on ${token.dex}` : ''}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold text-white">{formatPrice(token.priceUsd)}</p>
          <p className={`num text-sm ${pnlClass(token.change1h)}`}>{formatPct(token.change1h)} 1h</p>
          <p className="num text-xs text-zinc-500">{formatPct(token.change5m)} 5m &middot; {formatPct(token.change24h)} 24h</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><ChartBar className="h-3 w-3" aria-hidden />Buy pressure, {flowLabel}</span>
            <span className="num text-zinc-300">{buyPct == null ? 'Too few trades' : `${buyPct.toFixed(0)}% buys`}</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-rose-400/40" role="progressbar" aria-valuenow={buyPct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Share of trades that are buys">
            <div className="h-full bg-emerald-400" style={{ width: `${buyPct ?? 0}%` }} />
          </div>
          <p className="num mt-1 text-[11px] text-zinc-500">{formatNumber(flow.buys, 0)} buys by {formatNumber(flow.buyers, 0)} wallets, {formatNumber(flow.sells, 0)} sells by {formatNumber(flow.sellers, 0)}</p>
        </div>
        {token.graduation ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" aria-hidden />Bonding curve</span>
              <span className="num text-zinc-300">{token.graduation.completed ? 'Graduated' : `${token.graduation.percent.toFixed(0)}%`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={token.graduation.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Bonding curve progress">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-blue-300" style={{ width: `${token.graduation.percent}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">{token.graduation.completed ? 'Now trades on an open exchange.' : 'Share of the way to an open exchange listing.'}</p>
          </div>
        ) : (
          <p className="self-center text-[11px] text-zinc-600">No bonding curve data for this pool.</p>
        )}
      </div>

      <div className="mt-3"><DeveloperLine token={token} /></div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ['Liquidity', token.onCurve ? 'Bonding curve' : formatCompactUsd(token.liquidityUsd)], ['Market cap', formatCompactUsd(token.marketCapUsd)],
          ['Volume 24h', formatCompactUsd(token.volume24hUsd)], ['Holders', token.holders == null ? 'Not known' : formatNumber(token.holders, 0)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.04] px-3 py-2"><dt className="eyebrow text-[10px]">{k}</dt><dd className="num font-semibold text-white">{v}</dd></div>
        ))}
      </dl>

      {(token.score.reasons.length > 0 || token.score.warnings.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs">
          {token.score.reasons.slice(0, 3).map((r) => <li key={r} className="flex items-start gap-1.5 text-emerald-200/90"><CheckCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{r}</li>)}
          {token.score.warnings.slice(0, 3).map((w) => <li key={w} className="flex items-start gap-1.5 text-amber-200/90"><Warning className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{w}</li>)}
        </ul>
      )}
      {!verdict.ok && <p className="mt-2 text-xs text-zinc-500">Not bought by the auto sniper: {verdict.reasons.slice(0, 3).join('; ')}.</p>}

      <div className="mt-3 flex gap-2">
        <button onClick={() => onSnipe(token)} className={`btn h-10 flex-1 ${token.score.blocked ? 'btn-secondary' : 'btn-buy'}`}>
          <Crosshair className="h-4 w-4" aria-hidden /> Paper snipe {formatUsd(filters.maxPositionUsd, 0)}
        </button>
        {!tracked && <button onClick={() => onTrack(token)} className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Track ${token.symbol}`}><Plus className="h-4 w-4" weight="bold" /></button>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Open ${token.symbol} on GeckoTerminal`}><ArrowSquareOut className="h-4 w-4" /></a>}
      </div>
    </article>
  );
}

/** A plain token card for search results and tracked tokens, which have no launchpad score. */
function BasicCard({ token, security, filters, held, onSnipe, onTrack, tracked }: {
  token: SniperToken; security: Security | 'loading' | undefined; filters: SniperFilters; held: boolean;
  onSnipe: (t: SniperToken) => void; onTrack?: (t: SniperToken) => void; tracked?: boolean;
}) {
  const sec = security && security !== 'loading' ? security : undefined;
  const verdict = passesFilters(token, sec, filters);
  const link = safeHref(token.url);
  return (
    <article className="panel-inset p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="max-w-[10rem] truncate text-lg font-semibold text-white">{token.symbol}</h3>
            <Pill tone="zinc">{chainLabel(token.chain)}</Pill>
            <RiskBadge security={security ?? 'loading'} />
            {held && <Pill tone="blue">Holding</Pill>}
          </div>
          <p className="truncate text-sm text-zinc-400">{token.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold text-white">{formatPrice(token.priceUsd)}</p>
          <p className={`num text-sm ${pnlClass(token.change24h)}`}>{formatPct(token.change24h)} 24h</p>
        </div>
      </div>
      <dl className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ['Liquidity', formatCompactUsd(token.liquidityUsd)], ['Market cap', formatCompactUsd(token.marketCapUsd)],
          ['Volume 24h', formatCompactUsd(token.volume24hUsd)], ['Buys / sells', `${token.buys24h} / ${token.sells24h}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.04] px-3 py-2"><dt className="eyebrow text-[10px]">{k}</dt><dd className="num font-semibold text-white">{v}</dd></div>
        ))}
      </dl>
      {sec && sec.flags.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {sec.flags.slice(0, 5).map((f) => <li key={f} className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">{f}</li>)}
        </ul>
      )}
      {!verdict.ok && security !== 'loading' && security !== undefined && <p className="mb-3 text-xs text-zinc-500">Does not match your filters: {verdict.reasons.join('; ')}.</p>}
      <div className="flex gap-2">
        <button onClick={() => onSnipe(token)} className="btn btn-buy h-10 flex-1"><Crosshair className="h-4 w-4" aria-hidden /> Paper snipe {formatUsd(filters.maxPositionUsd, 0)}</button>
        {onTrack && !tracked && <button onClick={() => onTrack(token)} className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Track ${token.symbol}`}><Plus className="h-4 w-4" weight="bold" /></button>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Open ${token.symbol} chart`}><ArrowSquareOut className="h-4 w-4" /></a>}
      </div>
    </article>
  );
}

type Tab = FeedView | 'tracked';

export function SniperPanel() {
  const paper = usePaper();
  const [filters, setFilters] = useState<SniperFilters>(loadFilters);
  const [chain, setChain] = useState<string>(() => readJson<string>(CHAIN_KEY, 'solana'));
  const [launchpad, setLaunchpad] = useState('all');
  const [tab, setTab] = useState<Tab>('new');
  const [auto, setAuto] = useState(false);
  const [tracked, setTracked] = useState<SniperToken[]>(() => readJson<SniperToken[]>(TRACKED_KEY, []).filter((t) => t && typeof t.id === 'string'));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SniperToken[]>([]);
  const [security, setSecurity] = useState<Record<string, Security | 'loading'>>({});
  const requested = useRef(new Set<string>());
  const autoDone = useRef(new Set<string>(readJson<string[]>(AUTO_KEY, [])));

  const chainList = usePolling((s) => sniperService.chains(s), null);
  const chains: ChainOption[] = chainList.data && chainList.data.length > 0 ? chainList.data : FALLBACK_CHAINS;
  const activeChain = chains.find((c) => c.key === chain) ?? chains[0];
  const view: FeedView = tab === 'active' ? 'active' : 'new';

  const feed = usePolling((s) => sniperService.feed(activeChain.key, launchpad, view, s), 20_000, [activeChain.key, launchpad, view]);
  const trackedIds = useMemo(() => tracked.map((t) => t.id), [tracked]);
  const trackedLive = usePolling((s) => sniperService.refresh(trackedIds, s), trackedIds.length ? 12_000 : null, [trackedIds.join(',')]);

  const tokens = useMemo(() => feed.data?.tokens ?? [], [feed.data]);
  const trackedTokens = useMemo(() => {
    const fresh = new Map((trackedLive.data ?? []).map((t) => [t.id, t]));
    return tracked.map((t) => fresh.get(t.id) ?? t);
  }, [tracked, trackedLive.data]);

  useEffect(() => { writeJson(FILTERS_KEY, filters); }, [filters]);
  useEffect(() => { writeJson(TRACKED_KEY, tracked); }, [tracked]);
  useEffect(() => { writeJson(CHAIN_KEY, chain); }, [chain]);

  const selectChain = (key: string) => {
    setChain(key);
    setLaunchpad('all');
    setResults([]);
  };

  // Contract risk for search results and tracked tokens, a few at a time. A failed check is
  // remembered as "no risk data" instead of being retried on every render.
  const plain = tab === 'tracked' ? [...results, ...trackedTokens] : results;
  const plainKey = plain.map((t) => t.id).join(',');
  useEffect(() => {
    const todo = plain.filter((t) => !requested.current.has(t.id)).slice(0, 4);
    for (const t of todo) {
      requested.current.add(t.id);
      setSecurity((prev) => ({ ...prev, [t.id]: 'loading' }));
      sniperService
        .security(t.chain, t.address)
        .then((s) => setSecurity((prev) => ({ ...prev, [t.id]: s })))
        .catch(() => setSecurity((prev) => ({ ...prev, [t.id]: NO_RISK_DATA })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plainKey, security]);

  const sniperPositions = paper.positions.filter((p) => p.source === 'sniper');
  const record = useMemo(() => snipeRecord(paper.account.fills), [paper.account.fills]);

  const snipe = useCallback(
    (token: SniperToken, automatic = false) => {
      if (!token.priceUsd || token.priceUsd <= 0) return toast.error('No live price for this token.');
      const scored = token as Partial<FeedToken>;
      if (!automatic && scored.score?.blocked) {
        toast.warning(`${scored.score.warnings[0] ?? 'A serious risk was found'}. This is a paper trade only.`);
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
    [filters, paper],
  );

  const passing = useMemo(() => tokens.filter((t) => judge(t, filters, activeChain.riskChecks).ok), [tokens, filters, activeChain.riskChecks]);

  // Auto mode: buy the best rated token that passes every filter. Runs only while this page is open.
  useEffect(() => {
    if (!auto || sniperPositions.length >= MAX_AUTO_POSITIONS) return;
    const pick = passing.find((t) => !autoDone.current.has(t.id) && !paper.account.positions[t.id]);
    if (!pick) return;
    autoDone.current.add(pick.id);
    writeJson(AUTO_KEY, [...autoDone.current].slice(-300));
    snipe(pick, true);
  }, [auto, passing, paper.account.positions, sniperPositions.length, snipe]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return toast.error('Enter a token name, symbol or contract address.');
    setSearching(true);
    try {
      const found = await sniperService.search(q, activeChain.key);
      setResults(found);
      if (found.length === 0) toast.info(`Nothing found on ${activeChain.name}.`);
    } catch (e) {
      toast.error(errorMessage(e, 'Search failed.'));
    } finally {
      setSearching(false);
    }
  };

  const track = (t: SniperToken) => {
    setTracked((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev].slice(0, 30)));
    toast.success(`Tracking ${t.symbol}`);
  };

  const setFilter = (key: keyof SniperFilters, raw: string, max: number) => {
    const n = Number(raw);
    setFilters((prev) => ({ ...prev, [key]: Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : prev[key] }));
  };

  const chip = (active: boolean) =>
    `shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${active ? 'border-blue-300/40 bg-blue-400/15 text-blue-100' : 'border-white/[0.07] bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white'}`;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <PageHeader
        icon={<Crosshair />} tone="amber" title="Sniper Engine" badge={<PaperBadge />}
        subtitle="Launchpad tokens ranked by buy pressure, developer record and contract safety. Snipes are simulated at the live price."
        actions={
          <button onClick={() => setAuto((a) => !a)} aria-pressed={auto} className={`btn h-10 px-5 ${auto ? 'btn-buy' : 'btn-secondary'}`}>
            {auto ? <Pause className="h-4 w-4" weight="fill" aria-hidden /> : <Play className="h-4 w-4" weight="fill" aria-hidden />}
            {auto ? 'Auto sniping on' : 'Start auto sniping'}
          </button>
        }
      />
      {auto && (
        <p role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] px-3.5 py-2.5 text-xs text-emerald-200">
          Auto mode buys the best rated token that passes every filter on {activeChain.name}, up to {MAX_AUTO_POSITIONS} open positions. It only runs while this page is open.
        </p>
      )}

      <Card className="space-y-3 p-4">
        <div>
          <p className="eyebrow mb-2">Chain</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Chain">
            {chains.map((c) => (
              <button key={c.key} role="tab" aria-selected={activeChain.key === c.key} onClick={() => selectChain(c.key)} className={chip(activeChain.key === c.key)}>{c.name}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-2">Launchpad</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Launchpad">
            <button role="tab" aria-selected={launchpad === 'all'} onClick={() => setLaunchpad('all')} className={chip(launchpad === 'all')}>All new pools</button>
            {activeChain.launchpads.map((l) => (
              <button key={l.id} role="tab" aria-selected={launchpad === l.id} onClick={() => setLaunchpad(l.id)} className={chip(launchpad === l.id)}>{l.name}</button>
            ))}
            {activeChain.launchpads.length === 0 && chainList.data && <span className="self-center text-xs text-zinc-600">No dedicated launchpad is tracked on {activeChain.name} yet, so every new pool is shown.</span>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-1 flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Trophy /></IconTile>Measured results</h2>
            <p className="mb-4 text-[11px] leading-relaxed text-zinc-500">The sniper's real record from closed paper snipes. No filter can guarantee a win rate, so judge it on these numbers.</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Win rate</dt><dd className="num text-xl font-semibold text-white">{record.winRatePct == null ? 'No data' : `${record.winRatePct.toFixed(0)}%`}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Closed snipes</dt><dd className="num text-xl font-semibold text-white">{record.closed}{record.closed > 0 && <span className="text-xs text-zinc-500"> ({record.wins} won)</span>}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Realised profit</dt><dd className={`num text-xl font-semibold ${record.closed ? pnlClass(record.realizedUsd) : 'text-white'}`}>{formatUsd(record.realizedUsd)}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Open snipes</dt><dd className="num text-xl font-semibold text-white">{sniperPositions.length}</dd></div>
            </dl>
            <dl className="mt-3 space-y-1.5 text-xs">
              {[
                ['Tokens in this feed', String(tokens.length)], ['Fully checked', String(feed.data?.checked ?? 0)],
                ['Passing your filters', String(passing.length)], ['Developers on record', String(feed.data?.developersKnown ?? 0)],
                ['Paper cash', formatUsd(paper.availableCash)],
              ].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-zinc-500">{k}</dt><dd className="num font-medium text-zinc-200">{v}</dd></div>)}
            </dl>
          </Card>

          {sniperPositions.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold text-white">Open snipes</h2>
              <ul className="space-y-3">
                {sniperPositions.map((p) => (
                  <li key={p.key} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{p.symbol}</span>
                      <span className={`num ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPct == null ? 'Waiting for price' : formatPct(p.unrealizedPct)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span className="num">{formatUsd(p.value)}</span>
                      <button
                        onClick={() => {
                          if (!p.price) return toast.error('No live price yet.');
                          const r = paper.sellMarket(p.key, p.qty, p.price);
                          if (!r.ok) toast.error(r.error);
                          else toast.success(`Sold ${p.symbol}`);
                        }}
                        className="text-rose-300 hover:text-rose-200"
                      >Sell all</button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2.5 font-semibold text-white"><IconTile tone="amber" size="sm"><FunnelSimple /></IconTile>Filters</h2>
            <div className="space-y-5">
              {FIELD_GROUPS.map((group) => (
                <fieldset key={group.title} className="space-y-3">
                  <legend className="eyebrow mb-1">{group.title}</legend>
                  {group.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-xs font-medium text-zinc-300">{f.label}</span>
                      <span className="mb-1.5 block text-[11px] text-zinc-500">{f.help}</span>
                      <input type="number" inputMode="decimal" min={0} max={f.max} step="any" value={filters[f.key]} onChange={(e) => setFilter(f.key, e.target.value, f.max)} className="field num py-2" />
                    </label>
                  ))}
                </fieldset>
              ))}
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs text-zinc-400 hover:text-white">Reset to the strict defaults</button>
            </div>
          </Card>
        </div>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Token lists" className="seg">
              {([['new', 'Just launched'], ['active', 'Most active'], ['tracked', `Tracked (${tracked.length})`]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="seg-item">{label}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void runSearch(); }} className="flex min-w-[220px] flex-1 gap-2">
              <div className="relative flex-1">
                <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
                <label className="sr-only" htmlFor="sniper-search">Search tokens</label>
                <input id="sniper-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${activeChain.name} by name, symbol or address`} className="field py-2 pl-9" maxLength={64} />
              </div>
              <button type="submit" disabled={searching} className="btn btn-primary">{searching ? 'Searching...' : 'Search'}</button>
            </form>
          </div>

          {results.length > 0 && (
            <div className="mb-5 rounded-xl border border-blue-300/20 bg-blue-400/[0.05] p-3">
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-blue-100">Search results</p><button onClick={() => setResults([])} aria-label="Close results" className="text-zinc-400 hover:text-white"><X className="h-4 w-4" /></button></div>
              <div className="space-y-3">
                {results.map((t) => <BasicCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} />)}
              </div>
            </div>
          )}

          {tab === 'tracked' ? (
            trackedTokens.length === 0 ? (
              <Empty title="You are not tracking any tokens">Press the plus button on any token to follow its live price here.</Empty>
            ) : (
              <div className="space-y-3">
                {trackedTokens.map((t) => (
                  <div key={t.id} className="relative">
                    <BasicCard token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} tracked />
                    <button onClick={() => setTracked((prev) => prev.filter((x) => x.id !== t.id))} className="absolute right-3 top-3 text-[11px] text-zinc-500 hover:text-rose-300">Stop tracking</button>
                  </div>
                ))}
              </div>
            )
          ) : feed.loading && !feed.data ? <Loading label={`Scanning ${activeChain.name} launchpads`} />
          : feed.error && tokens.length === 0 ? <ErrorNotice message={feed.error} onRetry={feed.refresh} />
          : tokens.length === 0 ? <Empty title={`Nothing here on ${activeChain.name} right now`}>Try another launchpad, or switch between Just launched and Most active.</Empty>
          : (
            <>
              {feed.error && <div className="mb-3"><ErrorNotice message={`Showing the last list we received. ${feed.error}`} onRetry={feed.refresh} /></div>}
              <div className="space-y-3">
                {tokens.map((t) => (
                  <FeedCard key={t.id} token={t} filters={filters} riskChecks={activeChain.riskChecks} held={Boolean(paper.account.positions[t.id])} tracked={tracked.some((x) => x.id === t.id)} onSnipe={snipe} onTrack={track} />
                ))}
              </div>
            </>
          )}
          <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
            Pools, launchpad progress, developer wallets and holders from GeckoTerminal. Contract risk from GoPlus{activeChain.riskChecks ? '' : `, which does not cover ${activeChain.name}`}.
            A developer's record covers the launches this service has observed, so it grows over time. Scores rank candidates and cannot promise a profit. Most new tokens lose value.
          </p>
        </Card>
      </div>
    </div>
  );
}
