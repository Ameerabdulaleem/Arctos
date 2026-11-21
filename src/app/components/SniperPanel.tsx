import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowSquareOut, ArrowsLeftRight, Bell, ChartBar, CheckCircle, CircleNotch, Crosshair, Fire, FunnelSimple, GraduationCap, MagnifyingGlass, Pause, Play, Plus,
  Shield, ShieldCheck, ShieldWarning, Target, Trophy, UserCircle, Vault, Wallet, Warning, X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Card, Empty, ErrorNotice, IconTile, Loading, PageHeader, PaperBadge, Pill } from './ui/common';
import { CopyAddress } from './ui/CopyAddress';
import { DexScreenerEmbed } from './DexScreenerEmbed';
import type { QuickSwapDone, QuickSwapRequest } from './swap/QuickSwap';
import { ExitPlanCard, OpenSnipe } from './ExitPlan';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { loadExit, saveExit, type ExitSettings } from '../lib/exitPlan';
import { errorMessage } from '../services/api';
import { MAX_MANAGED_SNIPES } from '../services/keeperService';
import { statusService } from '../services/statusService';
import {
  DEFAULT_FILTERS, FALLBACK_CHAINS, chainLabel, discoverService, judge, passesFilters, snipeRecord, sniperService,
  type ChainOption, type DiscoverList, type DiscoverToken, type FeedToken, type FeedView, type Meta, type Security, type SniperFilters, type SniperToken,
} from '../services/sniperService';
import {
  AUTO_CHAINS, MAX_OPEN_LIMIT, dueAlerts, readMode, readWalletSettings, readWalletSnipes, saveMode, saveWalletSettings, saveWalletSnipes, validSpend,
  type AutoStrategy, type SniperMode, type WalletSettings, type WalletSnipe,
} from '../lib/walletSnipes';
import { useSwapWallets } from '../swap/useSwapWallets';
import { parseAmount, toNumber } from '../swap/amount';
import { balanceOf } from '../swap/balances';
import { SOLANA_ID } from '../swap/chains';
import { sniperAddress, SOL_RESERVE } from '../swap/sniperWallet';
import { evmReserve, evmSniperAddress, evmSniperBuy, evmSniperSell, evmSniperTokenBalance } from '../swap/sniperEvm';
import { sniperBuy, sniperSell } from '../swap/sniperTrade';
import { lookupOnChain } from '../swap/tokens';
import { chaseCheck, smartVerdict } from '../lib/smartSnipe';
import { describePlan } from '../lib/exitPlan';
import { useTickers } from '../hooks/useTickers';
import { Collapsible } from './ui/Collapsible';
import { AutoSniperCard } from './sniper/AutoSniperCard';
import { SniperWalletCard } from './sniper/SniperWalletCard';
import { useAutoSniper } from './sniper/useAutoSniper';
import { formatCompactUsd, formatDollarPrice, formatDollars, formatNumber, formatPct, formatPrice, formatUsd, pnlClass, safeHref, shortAddress, timeAgo } from '../lib/format';
import { WALLET_OPTIONS } from '../services/walletService';
import { chainByKey, looksLikeAddress } from '../swap/chains';

// Real buys and sells load the swap engine only when wallet mode is used.
const QuickSwap = lazy(() => import('./swap/QuickSwap'));

const FILTERS_KEY = 'arctos_sniper_filters_v2';
const TRACKED_KEY = 'arctos_sniper_tracked';
const AUTO_KEY = 'arctos_sniper_auto_done';
const CHAIN_KEY = 'arctos_sniper_chain';
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
      { key: 'maxPositionUsd', label: 'Position size ($)', help: 'Paper money spent per snipe. How it is sold is set in the exit plan.', max: 1e7 },
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

/** What the main button of a token card does: a paper snipe, or a real buy in the wallet. */
interface BuyAction {
  label: string;
  disabled?: boolean;
  title?: string;
}

function FeedCard({ token, filters, riskChecks, held, tracked, onSnipe, onTrack, buy, strategy }: {
  token: FeedToken; filters: SniperFilters; riskChecks: boolean; held: boolean; tracked: boolean;
  onSnipe: (t: SniperToken) => void; onTrack: (t: SniperToken) => void; buy: BuyAction; strategy: AutoStrategy;
}) {
  // Judged the way the auto sniper is set to judge: the automatic filter, or the user's filters.
  const verdict = strategy === 'smart' ? (() => { const v = smartVerdict(token, token.security); return { ok: v.ok, reasons: v.reasons }; })() : judge(token, filters, riskChecks);
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
            <CopyAddress value={token.address} label={`Copy ${token.symbol} contract address`} show />
            {token.launchpad && <Pill tone="violet">{token.launchpad}</Pill>}
            <RiskBadge security={token.score.checked ? token.security : 'loading'} />
            {verdict.ok && <Pill tone="green"><CheckCircle className="h-3 w-3" weight="fill" aria-hidden />{strategy === 'smart' ? 'Passes the automatic filter' : 'Passes your filters'}</Pill>}
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

      <ChaseNote token={token} />
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
      {!verdict.ok && <p className="mt-2 text-xs text-zinc-500">{strategy === 'smart' ? 'The automatic filter skips it' : 'Not bought by the auto sniper'}: {verdict.reasons.slice(0, 2).join('; ')}.</p>}

      <div className="mt-3 flex gap-2">
        <button onClick={() => onSnipe(token)} disabled={buy.disabled} title={buy.title} className={`btn h-10 flex-1 ${token.score.blocked ? 'btn-secondary' : 'btn-buy'}`}>
          <Crosshair className="h-4 w-4" aria-hidden /> {buy.label}
        </button>
        <SwapLink token={token} />
        {!tracked && <button onClick={() => onTrack(token)} className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Track ${token.symbol}`}><Plus className="h-4 w-4" weight="bold" /></button>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Open ${token.symbol} on GeckoTerminal`}><ArrowSquareOut className="h-4 w-4" /></a>}
      </div>
    </article>
  );
}

/** A link that opens the token in the trading terminal's swap panel, for a real swap in the user's wallet. */
function swapHref(token: SniperToken): string | null {
  const chain = chainByKey(token.chain);
  if (!chain || !looksLikeAddress(chain, token.address)) return null;
  return `#/trading?chain=${encodeURIComponent(chain.key)}&token=${encodeURIComponent(token.address)}`;
}

function SwapLink({ token }: { token: SniperToken }) {
  const href = swapHref(token);
  if (!href) return null;
  return <a href={href} className="btn btn-secondary h-10 px-3 text-sm" aria-label={`Swap ${token.symbol} for real in the trading terminal`}><ArrowsLeftRight className="h-4 w-4" aria-hidden /> Swap</a>;
}

/** A plain token card for search results and tracked tokens, which have no launchpad score. */
function BasicCard({ token, security, filters, held, onSnipe, onTrack, tracked, buy, extra }: {
  token: SniperToken; security: Security | 'loading' | undefined; filters: SniperFilters; held: boolean;
  onSnipe: (t: SniperToken) => void; onTrack?: (t: SniperToken) => void; tracked?: boolean; buy: BuyAction; extra?: ReactNode;
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
            <CopyAddress value={token.address} label={`Copy ${token.symbol} contract address`} show />
            <Pill tone="zinc">{chainLabel(token.chain)}</Pill>
            <RiskBadge security={security ?? 'loading'} />
            {held && <Pill tone="blue">Holding</Pill>}
          </div>
          <p className="truncate text-sm text-zinc-400">{token.name}{token.createdAt ? <span className="text-zinc-600">, pool {timeAgo(token.createdAt)}</span> : null}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold text-white">{formatPrice(token.priceUsd)}</p>
          <p className={`num text-sm ${pnlClass(token.change24h)}`}>{formatPct(token.change24h)} 24h</p>
          {token.change1h != null && <p className={`num text-xs ${pnlClass(token.change1h)}`}>{formatPct(token.change1h)} 1h</p>}
        </div>
      </div>
      {extra}
      <ChaseNote token={token} className="-mt-1 mb-3" />
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
        <button onClick={() => onSnipe(token)} disabled={buy.disabled} title={buy.title} className="btn btn-buy h-10 flex-1"><Crosshair className="h-4 w-4" aria-hidden /> {buy.label}</button>
        <SwapLink token={token} />
        {onTrack && !tracked && <button onClick={() => onTrack(token)} className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Track ${token.symbol}`}><Plus className="h-4 w-4" weight="bold" /></button>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-icon h-10 w-10" aria-label={`Open ${token.symbol} chart`}><ArrowSquareOut className="h-4 w-4" /></a>}
      </div>
    </article>
  );
}

/** Warns when buying now would mean chasing a spike or catching a falling price. */
function ChaseNote({ token, className = 'mt-2' }: { token: SniperToken; className?: string }) {
  const c = chaseCheck(token);
  if (!c.note) return null;
  return <p className={`flex items-start gap-1.5 text-xs text-amber-200 ${className}`}><Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{c.chasing ? 'Chasing risk' : 'Falling'}: {c.note}</p>;
}

/** Rank, boosts, description and links for a token from one of DexScreener's lists. */
function DiscoverExtra({ token }: { token: DiscoverToken }) {
  const links = (token.links ?? []).map((l) => ({ ...l, href: safeHref(l.url) })).filter((l) => l.href?.startsWith('https://')).slice(0, 4);
  if (!token.rank && !token.boosts && !token.description && links.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5 text-xs">
      <p className="flex flex-wrap items-center gap-2 text-zinc-400">
        {token.rank != null && <span className="num rounded bg-white/[0.06] px-1.5 py-0.5 text-zinc-200">#{token.rank}</span>}
        {token.boosts != null && token.boosts > 0 && <span className="inline-flex items-center gap-1 text-amber-300"><Fire className="h-3 w-3" weight="fill" aria-hidden />{formatNumber(token.boosts, 0)} boosts (paid promotion)</span>}
        {links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-300 hover:text-blue-200">{l.kind === 'twitter' ? 'X' : l.kind}</a>)}
      </p>
      {token.description && <p className="line-clamp-2 text-zinc-500">{token.description}</p>}
    </div>
  );
}

function MetasGrid({ metas, selected, onPick }: { metas: Meta[]; selected: string | null; onPick: (slug: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metas.map((m) => (
        <button key={m.slug} type="button" onClick={() => onPick(m.slug)} aria-pressed={selected === m.slug}
          className={`rounded-xl border p-3 text-left transition ${selected === m.slug ? 'border-blue-300/50 bg-blue-400/10' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/20'}`}>
          <p className="truncate text-sm font-semibold text-white">{m.icon ? `${m.icon} ` : ''}{m.name}</p>
          <p className="num mt-1 text-xs text-zinc-300">{formatCompactUsd(m.marketCap)} <span className={pnlClass(m.change24h)}>{formatPct(m.change24h, 1)}</span></p>
          <p className="num text-[11px] text-zinc-500">1h <span className={pnlClass(m.change1h)}>{formatPct(m.change1h, 1)}</span>, vol {formatCompactUsd(m.volume)}, {m.tokenCount ?? 0} tokens</p>
        </button>
      ))}
    </div>
  );
}

function WalletSnipeRow({ snipe, price, alerts, onSell, onForget }: {
  snipe: WalletSnipe; price: number | null; alerts: string[]; onSell: (fraction: number) => void; onForget: () => void;
}) {
  const chain = chainByKey(snipe.chain);
  const pnlPct = price != null ? (price / snipe.entryPriceUsd - 1) * 100 : null;
  return (
    <li className="panel-inset p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 font-semibold text-white">{snipe.symbol}<CopyAddress value={snipe.address} label={`Copy ${snipe.symbol} contract address`} /><span className="text-xs font-normal text-zinc-500">{chain?.name ?? snipe.chain}</span></p>
          <p className="text-xs text-zinc-500">Bought with {snipe.spent} at {formatPrice(snipe.entryPriceUsd)}, {timeAgo(snipe.at)}{snipe.link && <>, <a href={snipe.link} target="_blank" rel="noopener noreferrer" className="text-blue-300">transaction</a></>}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-sm text-white">{price == null ? 'No price' : formatUsd(snipe.qty * price)}</p>
          <p className={`num text-xs ${pnlClass(pnlPct)}`}>{pnlPct == null ? '' : formatPct(pnlPct)}</p>
        </div>
      </div>
      {alerts.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-200"><Bell className="h-3.5 w-3.5" aria-hidden />{alerts.join('. ')}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onSell(0.5)} className="btn btn-secondary btn-sm">Sell 50%</button>
        <button type="button" onClick={() => onSell(1)} className="btn btn-sell btn-sm">Sell all</button>
        <button type="button" onClick={onForget} className="ml-auto text-[11px] text-zinc-500 hover:text-rose-300" title="Stop following this snipe here. Nothing is sold.">Forget</button>
      </div>
    </li>
  );
}

type Tab = FeedView | 'tracked' | 'dex';
type DexView = DiscoverList | 'metas' | 'live';
const DEX_VIEWS: Array<[DexView, string]> = [['boosted', 'Top boosted'], ['profiles', 'New profiles'], ['takeovers', 'Takeovers'], ['metas', 'Metas'], ['live', 'Live DexScreener']];

export function SniperPanel() {
  const paper = usePaper();
  const [filters, setFilters] = useState<SniperFilters>(loadFilters);
  const [exit, setExit] = useState<ExitSettings>(loadExit);
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

  // Paper account or the user's own wallet.
  const [mode, setModeState] = useState<SniperMode>(readMode);
  const [walletSettings, setWalletSettings] = useState<WalletSettings>(readWalletSettings);
  const [walletSnipes, setWalletSnipes] = useState<WalletSnipe[]>(readWalletSnipes);
  const [quick, setQuick] = useState<QuickSwapRequest | null>(null);
  const [evmMenu, setEvmMenu] = useState(false);
  const entryPrice = useRef<number | null>(null);
  const wallets = useSwapWallets();
  const setMode = (m: SniperMode) => {
    setModeState(m);
    saveMode(m);
    if (m === 'wallet') setAuto(false);
  };
  useEffect(() => { saveWalletSettings(walletSettings); }, [walletSettings]);
  useEffect(() => { saveWalletSnipes(walletSnipes); }, [walletSnipes]);

  // DexScreener's trending lists and metas.
  const [dexView, setDexView] = useState<DexView>('boosted');
  const [dexAllChains, setDexAllChains] = useState(false);
  const [metaSlug, setMetaSlug] = useState<string | null>(null);

  const chainList = usePolling((s) => sniperService.chains(s), null);
  const service = usePolling((s) => statusService.get(s), null);
  const chains: ChainOption[] = chainList.data && chainList.data.length > 0 ? chainList.data : FALLBACK_CHAINS;
  const activeChain = chains.find((c) => c.key === chain) ?? chains[0];
  const view: FeedView = tab === 'active' ? 'active' : 'new';

  const feed = usePolling((s) => sniperService.feed(activeChain.key, launchpad, view, s), 20_000, [activeChain.key, launchpad, view]);
  const trackedIds = useMemo(() => tracked.map((t) => t.id), [tracked]);
  const trackedLive = usePolling((s) => sniperService.refresh(trackedIds, s), trackedIds.length ? 12_000 : null, [trackedIds.join(',')]);

  const tokens = useMemo(() => feed.data?.tokens ?? [], [feed.data]);

  const dexList = tab === 'dex' && (dexView === 'boosted' || dexView === 'profiles' || dexView === 'takeovers') ? dexView : null;
  const dexChain = dexAllChains ? 'all' : activeChain.key;
  const discover = usePolling((s) => (dexList ? discoverService.list(dexList, dexChain, s) : Promise.resolve(null)), dexList ? 30_000 : null, [dexList, dexChain]);
  const showMetas = tab === 'dex' && dexView === 'metas';
  const metas = usePolling((s) => (showMetas ? discoverService.metas(s) : Promise.resolve(null)), showMetas ? 60_000 : null, [showMetas]);
  const metaTokens = usePolling((s) => (showMetas && metaSlug ? discoverService.meta(metaSlug, s) : Promise.resolve(null)), showMetas && metaSlug ? 30_000 : null, [showMetas, metaSlug]);
  const dexTokens: DiscoverToken[] = useMemo(
    () => (dexList ? discover.data?.tokens ?? [] : showMetas && metaSlug ? metaTokens.data?.tokens ?? [] : []),
    [dexList, discover.data, showMetas, metaSlug, metaTokens.data],
  );

  // Live prices for wallet snipes, and the exit plan's alerts for them.
  const walletIds = useMemo(() => walletSnipes.map((w) => w.id), [walletSnipes]);
  const walletLive = usePolling((s) => sniperService.refresh(walletIds, s), walletIds.length ? 15_000 : null, [walletIds.join(',')]);
  const { tickers } = useTickers();
  const solPrice = tickers.SOL?.price ?? null;
  const [sniperLamports, setSniperLamports] = useState<bigint | null>(null);
  const onSniperBalance = useCallback((b: bigint | null) => setSniperLamports(b), []);
  const [evmBalances, setEvmBalances] = useState<Record<string, bigint | null>>({});
  const onEvmBalances = useCallback((b: Record<string, bigint | null>) => setEvmBalances((prev) => ({ ...prev, ...b })), []);
  const decimals = useRef(new Map<string, number>());
  const selling = useRef(new Set<string>());
  const slippageBps = Math.round(walletSettings.slippagePct * 100);
  const sniperOpen = walletSnipes.filter((w) => w.source === 'sniper');
  const walletPrice = useCallback((id: string) => walletLive.data?.find((t) => t.id === id)?.priceUsd ?? null, [walletLive.data]);
  const trackedTokens = useMemo(() => {
    const fresh = new Map((trackedLive.data ?? []).map((t) => [t.id, t]));
    return tracked.map((t) => fresh.get(t.id) ?? t);
  }, [tracked, trackedLive.data]);

  useEffect(() => { writeJson(FILTERS_KEY, filters); }, [filters]);
  useEffect(() => { saveExit(exit); }, [exit]);
  useEffect(() => { writeJson(TRACKED_KEY, tracked); }, [tracked]);
  useEffect(() => { writeJson(CHAIN_KEY, chain); }, [chain]);

  const selectChain = (key: string) => {
    setChain(key);
    setLaunchpad('all');
    setResults([]);
  };

  // Contract risk for search results and tracked tokens, a few at a time. A failed check is
  // remembered as "no risk data" instead of being retried on every render.
  const plain = tab === 'tracked' ? [...results, ...trackedTokens] : tab === 'dex' ? [...results, ...dexTokens] : results;
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

  const walletSell = useCallback((w: WalletSnipe, fraction: number) => {
    entryPrice.current = null;
    setQuick({ side: 'sell', chainKey: w.chain, address: w.address, symbol: w.symbol, name: w.name, fraction, slippageBps: Math.round(walletSettings.slippagePct * 100) });
  }, [walletSettings.slippagePct]);

  const walletBuy = useCallback(async (token: SniperToken) => {
    const chain = chainByKey(token.chain);
    if (!chain || !looksLikeAddress(chain, token.address)) return toast.error(`Arctos cannot swap on ${chainLabel(token.chain)} yet. Use the paper account for it.`);
    const spend = walletSettings.spend[token.chain] ?? '';
    if (!validSpend(spend)) return toast.error(`Set how much ${chain.native.symbol} to spend per buy, above the list.`);
    if (chain.vm === 'svm' && !wallets.svm) {
      try {
        await wallets.connectSolanaWallet();
      } catch (e) {
        return toast.error(e instanceof Error ? e.message : 'Phantom could not connect.');
      }
    }
    if (chain.vm === 'evm' && !wallets.evm) {
      setEvmMenu(true);
      return toast.info('Connect an EVM wallet first, then press buy again.');
    }
    entryPrice.current = token.priceUsd > 0 ? token.priceUsd : null;
    setQuick({ side: 'buy', chainKey: token.chain, address: token.address, symbol: token.symbol, name: token.name, spend, slippageBps: Math.round(walletSettings.slippagePct * 100) });
  }, [walletSettings, wallets]);

  const onQuickDone = useCallback((done: QuickSwapDone) => {
    const r = done.request;
    const chain = chainByKey(r.chainKey);
    const id = `${r.chainKey}:${chain?.vm === 'evm' ? r.address.toLowerCase() : r.address}`;
    if (r.side === 'buy') {
      const qty = toNumber(done.quote.amountOut, done.req.to.decimals);
      const entry = entryPrice.current ?? (done.quote.inUsd != null && qty > 0 ? done.quote.inUsd / qty : null);
      if (!entry || !(qty > 0)) return;
      setWalletSnipes((list) => {
        const old = list.find((w) => w.id === id);
        const next: WalletSnipe = old
          ? { ...old, qty: old.qty + qty, entryPriceUsd: (old.entryPriceUsd * old.qty + entry * qty) / (old.qty + qty), alerted: [] }
          : { id, chain: r.chainKey, address: r.address, symbol: r.symbol, name: r.name, entryPriceUsd: entry, qty, spent: `${r.spend} ${chain?.native.symbol ?? ''}`.trim(), at: Date.now(), link: done.result.link, alerted: [] };
        return [next, ...list.filter((w) => w.id !== id)];
      });
    } else {
      const share = r.fraction ?? 1;
      setWalletSnipes((list) => (share >= 1 ? list.filter((w) => w.id !== id) : list.map((w) => (w.id === id ? { ...w, qty: w.qty * (1 - share) } : w))));
    }
  }, []);

  // ------------------------------------------------------------ sniper wallet trades (no popups)

  const decimalsOf = useCallback(async (mint: string): Promise<number | null> => {
    const known = decimals.current.get(mint);
    if (known != null) return known;
    const sol = chainByKey('solana');
    const t = sol ? await lookupOnChain(sol, mint).catch(() => null) : null;
    if (t) decimals.current.set(mint, t.decimals);
    return t?.decimals ?? null;
  }, []);

  /** Why the sniper wallet cannot buy on this chain right now, or null when it can. */
  const sniperNotReady = useCallback((chainKey: string): string | null => {
    const chain = chainByKey(chainKey);
    if (!chain) return `the sniper wallet cannot trade on ${chainLabel(chainKey)}`;
    if (chain.vm === 'svm') {
      if (!sniperAddress()) return 'unlock the sniper wallet first';
      const spend = parseAmount(walletSettings.sniperSpend, 9);
      if (!spend) return 'set how much SOL to spend per buy';
      if (sniperLamports == null) return 'reading the Solana sniper wallet balance';
      if (sniperLamports < spend + SOL_RESERVE) return 'the Solana sniper wallet needs more SOL';
      return null;
    }
    if (!evmSniperAddress()) return 'unlock the EVM sniper wallet first';
    const spend = parseAmount(walletSettings.sniperSpendEvm[chain.key] ?? '', chain.native.decimals);
    if (!spend) return `set how much ${chain.native.symbol} to spend per buy on ${chain.name}`;
    if (!(chain.key in evmBalances)) return `reading the EVM sniper wallet balance on ${chain.name}`;
    const bal = evmBalances[chain.key];
    if (bal == null) return `the EVM sniper wallet balance on ${chain.name} could not be read just now`;
    if (bal === 0n) return `deposit ${chain.native.symbol} on ${chain.name} into the EVM sniper wallet`;
    if (bal < spend + evmReserve(chain)) return `the EVM sniper wallet needs more ${chain.native.symbol} on ${chain.name}`;
    return null;
  }, [walletSettings.sniperSpend, walletSettings.sniperSpendEvm, sniperLamports, evmBalances]);

  const evmSniperBuyToken = useCallback(async (token: SniperToken, automatic: boolean, why: string): Promise<boolean> => {
    const chain = chainByKey(token.chain);
    if (!chain || chain.vm !== 'evm' || !looksLikeAddress(chain, token.address)) return false;
    const notReady = sniperNotReady(token.chain);
    if (notReady) {
      if (!automatic) toast.error(`Not ready: ${notReady}.`);
      return false;
    }
    const spendText = walletSettings.sniperSpendEvm[chain.key] ?? '';
    const spend = parseAmount(spendText, chain.native.decimals) as bigint;
    const nativeUsd = tickers[chain.native.symbol === 'POL' ? 'POL' : chain.native.symbol]?.price ?? null;
    const pending = toast.loading(`Buying ${token.symbol} with ${spendText} ${chain.native.symbol} on ${chain.name}…`);
    try {
      const fill = await evmSniperBuy(chain.key, token.address, spend, slippageBps);
      const dec = fill.token.decimals;
      const qty = Number(fill.received) / 10 ** dec;
      const spentNative = Number(fill.spent) / 10 ** chain.native.decimals;
      const entry = nativeUsd && qty > 0 ? (spentNative * nativeUsd) / qty : token.priceUsd;
      const id = `${token.chain}:${token.address.toLowerCase()}`;
      setWalletSnipes((list) => {
        const old = list.find((w) => w.id === id);
        const next: WalletSnipe = old
          ? { ...old, qty: old.qty + qty, entryPriceUsd: (old.entryPriceUsd * old.qty + entry * qty) / (old.qty + qty), alerted: [] }
          : { id, chain: token.chain, address: token.address, symbol: token.symbol, name: token.name, entryPriceUsd: entry, qty, spent: `${spendText} ${chain.native.symbol}`, at: Date.now(), link: fill.link, alerted: [], source: 'sniper', decimals: dec };
        return [next, ...list.filter((w) => w.id !== id)];
      });
      setEvmBalances((b) => ({ ...b, [chain.key]: b[chain.key] == null ? null : (b[chain.key] as bigint) - fill.spent - fill.feeWei }));
      toast.success(`${automatic ? 'Auto sniped' : 'Bought'} ${token.symbol}`, { id: pending, description: `${spendText} ${chain.native.symbol} on ${chain.name} from the sniper wallet${why ? `. ${why}` : ''}` });
      return true;
    } catch (e) {
      toast.error(`${token.symbol} was not bought`, { id: pending, description: e instanceof Error ? e.message : undefined });
      return false;
    }
  }, [sniperNotReady, walletSettings.sniperSpendEvm, slippageBps, tickers]);

  const sniperBuyToken = useCallback(async (token: SniperToken, automatic: boolean, why = ''): Promise<boolean> => {
    if (token.chain !== 'solana') return evmSniperBuyToken(token, automatic, why);
    if (!sniperAddress()) {
      if (!automatic) toast.error('Unlock the sniper wallet first.');
      return false;
    }
    const lamports = parseAmount(walletSettings.sniperSpend, 9);
    if (!lamports) {
      toast.error('Set how much SOL the sniper wallet spends per buy.');
      return false;
    }
    if (sniperLamports != null && sniperLamports < lamports + SOL_RESERVE) {
      toast.error('Not enough SOL in the sniper wallet. Deposit more or lower the amount per buy.');
      return false;
    }
    const pending = toast.loading(`Buying ${token.symbol} with ${walletSettings.sniperSpend} SOL…`);
    try {
      const fill = await sniperBuy(token.address, lamports, slippageBps);
      const dec = (await decimalsOf(token.address)) ?? 6;
      const qty = Number(fill.received) / 10 ** dec;
      const spentSol = Number(fill.spent) / 1e9;
      const entry = solPrice && qty > 0 ? (spentSol * solPrice) / qty : token.priceUsd;
      const id = `solana:${token.address}`;
      setWalletSnipes((list) => {
        const old = list.find((w) => w.id === id);
        const next: WalletSnipe = old
          ? { ...old, qty: old.qty + qty, entryPriceUsd: (old.entryPriceUsd * old.qty + entry * qty) / (old.qty + qty), alerted: [] }
          : { id, chain: 'solana', address: token.address, symbol: token.symbol, name: token.name, entryPriceUsd: entry, qty, spent: `${walletSettings.sniperSpend} SOL`, at: Date.now(), link: fill.signature ? `https://solscan.io/tx/${fill.signature}` : null, alerted: [], source: 'sniper', decimals: dec };
        return [next, ...list.filter((w) => w.id !== id)];
      });
      toast.success(`${automatic ? 'Auto sniped' : 'Bought'} ${token.symbol}`, { id: pending, description: `${spentSol.toFixed(4)} SOL from the sniper wallet${why ? `. ${why}` : ''}` });
      setSniperLamports((b) => (b == null ? b : b - fill.spent));
      return true;
    } catch (e) {
      toast.error(`${token.symbol} was not bought`, { id: pending, description: e instanceof Error ? e.message : undefined });
      return false;
    }
  }, [walletSettings.sniperSpend, sniperLamports, slippageBps, decimalsOf, solPrice, evmSniperBuyToken]);

  const autoLog = useRef<(tone: 'buy' | 'sell' | 'skip' | 'info' | 'error', text: string) => void>(() => {});

  const evmSellSnipe = useCallback(async (w: WalletSnipe, fraction: number, reason: string) => {
    const chain = chainByKey(w.chain);
    if (!chain || chain.vm !== 'evm') return;
    if (!evmSniperAddress()) {
      toast.error('Unlock the EVM sniper wallet so it can sell.');
      return;
    }
    selling.current.add(w.id);
    const pending = toast.loading(`Selling ${Math.round(fraction * 100)}% of ${w.symbol} on ${chain.name}…`);
    try {
      const raw = await evmSniperTokenBalance(w.chain, w.address);
      if (raw == null) throw new Error('The token balance could not be read. Try again.');
      if (raw === 0n) {
        setWalletSnipes((list) => list.filter((x) => x.id !== w.id));
        toast.info(`No ${w.symbol} left in the sniper wallet.`, { id: pending });
        return;
      }
      const amount = fraction >= 1 ? raw : (raw * BigInt(Math.round(fraction * 10_000))) / 10_000n;
      const fill = await evmSniperSell(w.chain, w.address, amount, slippageBps);
      const back = Number(fill.received) / 10 ** chain.native.decimals;
      setWalletSnipes((list) => (fraction >= 1 ? list.filter((x) => x.id !== w.id) : list.map((x) => (x.id === w.id ? { ...x, qty: x.qty * (1 - fraction) } : x))));
      autoLog.current('sell', `Sold ${Math.round(fraction * 100)}% of ${w.symbol} for ${back.toFixed(5)} ${chain.native.symbol} (${reason})`);
      toast.success(`Sold ${w.symbol}`, { id: pending, description: `${back.toFixed(5)} ${chain.native.symbol} back in the sniper wallet. ${reason}` });
    } catch (e) {
      autoLog.current('error', `Selling ${w.symbol} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      toast.error(`${w.symbol} was not sold`, { id: pending, description: e instanceof Error ? e.message : undefined });
    } finally {
      selling.current.delete(w.id);
    }
  }, [slippageBps]);

  const sniperSellSnipe = useCallback(async (w: WalletSnipe, fraction: number, reason: string) => {
    if (selling.current.has(w.id)) return;
    if (w.chain !== 'solana') return evmSellSnipe(w, fraction, reason);
    const owner = sniperAddress();
    if (!owner) {
      toast.error('Unlock the sniper wallet so it can sell.');
      return;
    }
    selling.current.add(w.id);
    const pending = toast.loading(`Selling ${Math.round(fraction * 100)}% of ${w.symbol}…`);
    try {
      const dec = w.decimals ?? (await decimalsOf(w.address)) ?? 6;
      const raw = await balanceOf({ chainId: SOLANA_ID, address: w.address, symbol: w.symbol, name: w.name, decimals: dec }, owner);
      if (raw == null) throw new Error('The token balance could not be read. Try again.');
      if (raw === 0n) {
        setWalletSnipes((list) => list.filter((x) => x.id !== w.id));
        toast.info(`No ${w.symbol} left in the sniper wallet.`, { id: pending });
        return;
      }
      const amount = fraction >= 1 ? raw : (raw * BigInt(Math.round(fraction * 10_000))) / 10_000n;
      const fill = await sniperSell(w.address, amount, slippageBps);
      const sol = Number(fill.received) / 1e9;
      setWalletSnipes((list) => (fraction >= 1 ? list.filter((x) => x.id !== w.id) : list.map((x) => (x.id === w.id ? { ...x, qty: x.qty * (1 - fraction) } : x))));
      setSniperLamports((b) => (b == null ? b : b + fill.received));
      autoLog.current('sell', `Sold ${Math.round(fraction * 100)}% of ${w.symbol} for ${sol.toFixed(4)} SOL (${reason})`);
      toast.success(`Sold ${w.symbol}`, { id: pending, description: `${sol.toFixed(4)} SOL back in the sniper wallet. ${reason}` });
    } catch (e) {
      autoLog.current('error', `Selling ${w.symbol} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      toast.error(`${w.symbol} was not sold`, { id: pending, description: e instanceof Error ? e.message : undefined });
    } finally {
      selling.current.delete(w.id);
    }
  }, [slippageBps, decimalsOf, evmSellSnipe]);

  // Exit plan for wallet snipes. Sniper wallet snipes are sold automatically; snipes bought from
  // the user's own wallet raise an alert with a one click sell, since they need a signature.
  useEffect(() => {
    const fired: Array<{ id: string; alert: string }> = [];
    for (const w of walletSnipes) {
      const auto = w.source === 'sniper';
      if (!auto && mode !== 'wallet') continue;
      if (auto && !(w.chain === 'solana' ? sniperAddress() : evmSniperAddress())) continue;
      for (const a of dueAlerts(w, walletPrice(w.id), exit)) {
        fired.push({ id: w.id, alert: a.id });
        if (auto) {
          void sniperSellSnipe(w, a.sellPct / 100, a.text);
          break;
        }
        toast.warning(`${w.symbol}: ${a.text}`, {
          description: `Your exit plan sells ${a.sellPct}% here. In wallet mode you confirm it yourself.`,
          duration: 30_000,
          action: { label: `Sell ${a.sellPct}%`, onClick: () => walletSell(w, a.sellPct / 100) },
        });
      }
    }
    if (fired.length) setWalletSnipes((list) => list.map((w) => ({ ...w, alerted: [...w.alerted, ...fired.filter((f) => f.id === w.id).map((f) => f.alert)] })));
  }, [mode, walletSnipes, walletPrice, exit, walletSell, sniperSellSnipe]);

  const buyFor = (t: SniperToken): BuyAction => {
    if (mode === 'paper') return { label: `Paper snipe ${formatDollars(filters.maxPositionUsd, 0)}` };
    if (mode === 'sniper') {
      if (t.chain === 'solana') return { label: `Buy ${walletSettings.sniperSpend} SOL`, title: 'From the sniper wallet, with no popup' };
      const c = chainByKey(t.chain);
      return c && c.vm === 'evm' && looksLikeAddress(c, t.address)
        ? { label: `Buy ${walletSettings.sniperSpendEvm[c.key] ?? '?'} ${c.native.symbol}`, title: `From the EVM sniper wallet on ${c.name}, with no popup` }
        : { label: 'Paper only on this chain', disabled: true, title: `The sniper wallet cannot trade on ${chainLabel(t.chain)} yet.` };
    }
    const chain = chainByKey(t.chain);
    if (!chain || !looksLikeAddress(chain, t.address)) return { label: 'Paper only on this chain', disabled: true, title: `Arctos cannot swap on ${chainLabel(t.chain)} yet.` };
    return { label: `Buy ${walletSettings.spend[t.chain] ?? '?'} ${chain.native.symbol}` };
  };

  const paperBuy = useCallback((token: SniperToken, spend: number, note: string): boolean => {
    if (!token.priceUsd || token.priceUsd <= 0) {
      toast.error('No live price for this token.');
      return false;
    }
    if (!paper.account.positions[token.id] && sniperPositions.length >= MAX_MANAGED_SNIPES) {
      toast.error(`You can hold ${MAX_MANAGED_SNIPES} snipes at a time. Sell one first.`);
      return false;
    }
    const scored = token as Partial<FeedToken>;
    const qty = spend / (token.priceUsd * 1.001);
    const r = paper.buyMarket({ key: token.id, symbol: token.symbol, label: token.name, source: 'sniper' }, qty, token.priceUsd, {
      // Sold by the exit plan. The developer's share now is the mark the exit guard measures from.
      devHoldingPct: scored.developer?.holdingPct ?? undefined,
      note,
    });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(`${note === 'Auto snipe' ? 'Auto sniped' : 'Sniped'} ${token.symbol}`, { description: `${formatDollars(spend)} of paper money at ${formatDollarPrice(token.priceUsd)}.` });
    return true;
  }, [paper, sniperPositions.length]);

  const snipe = useCallback(
    (token: SniperToken, automatic = false) => {
      if (mode === 'wallet' && !automatic) {
        void walletBuy(token);
        return;
      }
      if (mode === 'sniper' && !automatic) {
        void sniperBuyToken(token, false);
        return;
      }
      const scored = token as Partial<FeedToken>;
      if (!automatic && scored.score?.blocked) {
        toast.warning(`${scored.score.warnings[0] ?? 'A serious risk was found'}. This is a paper trade only.`);
      }
      const chase = chaseCheck(token);
      if (!automatic && chase.note) toast.warning(chase.note);
      paperBuy(token, Math.min(filters.maxPositionUsd, paper.availableCash), automatic ? 'Auto snipe' : 'Paper snipe');
    },
    [filters, paper, mode, walletBuy, sniperBuyToken, paperBuy],
  );

  const passing = useMemo(() => tokens.filter((t) => judge(t, filters, activeChain.riskChecks).ok), [tokens, filters, activeChain.riskChecks]);

  // ------------------------------------------------------------ auto sniping

  const paperInSnipes = sniperPositions.reduce((s, p) => s + p.qty * p.avgPrice, 0);
  const autoScope: ChainOption[] = walletSettings.autoChains
    .map((k) => chains.find((c) => c.key === k))
    .filter((c): c is ChainOption => Boolean(c));
  const toggleAutoChain = (key: string) => setWalletSettings((s) => {
    const on = s.autoChains.includes(key);
    const next = on ? s.autoChains.filter((k) => k !== key) : [...s.autoChains, key];
    return { ...s, autoChains: next.length ? next : s.autoChains };
  });
  const openSnipes = mode === 'paper' ? sniperPositions.length : sniperOpen.length;
  const atLimit = openSnipes >= walletSettings.maxOpen;
  /** Why auto sniping cannot run at all. A full set of open snipes only pauses it. */
  const autoStartBlocked = (): string | null => {
    if (mode === 'wallet') return 'each buy from your own wallet needs your approval. Use the paper account or the sniper wallet for auto sniping.';
    if (mode === 'paper') {
      if (paper.availableCash < 10) return 'the paper cash is used up.';
      return null;
    }
    const reasons = autoScope.map((c) => sniperNotReady(c.key));
    if (reasons.every(Boolean)) return `${reasons[0]}.`;
    return null;
  };
  const autoBlocked = (): string | null => {
    const start = autoStartBlocked();
    if (start) return start;
    if (atLimit) return `${openSnipes} snipes are open, your limit. It carries on when one is sold, or raise the limit.`;
    if (mode === 'paper') {
      if (walletSettings.paperBudgetUsd - paperInSnipes < 10) return `the auto snipe budget of ${formatDollars(walletSettings.paperBudgetUsd, 0)} is all in open snipes.`;
      if (paper.availableCash < 10) return 'the paper cash is used up.';
      return null;
    }
    return null;
  };

  const autoSniper = useAutoSniper({
    enabled: auto,
    strategy: walletSettings.strategy,
    // In sniper mode only chains whose wallet is unlocked and funded are scanned.
    chains: () => (mode === 'sniper' ? autoScope.filter((c) => sniperNotReady(c.key) == null) : autoScope),
    scope: autoScope.map((c) => c.name).join(' and '),
    filters,
    isDone: (id) => autoDone.current.has(id) || Boolean(paper.account.positions[id]) || walletSnipes.some((w) => w.id === id),
    blocked: autoBlocked,
    buy: async (token, why) => {
      let ok: boolean;
      if (mode === 'sniper') {
        ok = await sniperBuyToken(token, true, why);
      } else {
        const spend = Math.min(filters.maxPositionUsd, walletSettings.paperBudgetUsd - paperInSnipes, paper.availableCash);
        ok = spend >= 10 && paperBuy(token, spend, 'Auto snipe');
      }
      if (ok) {
        autoDone.current.add(token.id);
        writeJson(AUTO_KEY, [...autoDone.current].slice(-300));
      }
      return ok;
    },
  });
  autoLog.current = autoSniper.log;
  const setStrategy = (strategy: AutoStrategy) => setWalletSettings((s) => ({ ...s, strategy }));

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
        icon={<Crosshair />} tone="amber" title="Sniper Engine"
        badge={mode === 'paper' ? <PaperBadge /> : mode === 'sniper' ? <Pill tone="violet"><Vault className="h-3 w-3" weight="fill" aria-hidden />Sniper wallet</Pill> : <Pill tone="green"><Wallet className="h-3 w-3" weight="fill" aria-hidden />Real wallet</Pill>}
        subtitle={mode === 'paper'
          ? 'Tokens ranked by buy pressure, developer record and contract safety. Snipes are simulated at the live price.'
          : mode === 'sniper'
            ? 'Real trades from your sniper wallet, with no popup per trade. Only what you deposit can be spent.'
            : 'Real swaps from your own wallet. You approve every buy and sell.'}
        actions={
          <>
            <div className="seg flex" role="radiogroup" aria-label="Trade with">
              <button type="button" role="radio" aria-checked={mode === 'paper'} onClick={() => setMode('paper')} className="seg-item px-3 py-1.5 text-xs font-medium">Paper</button>
              <button type="button" role="radio" aria-checked={mode === 'sniper'} onClick={() => setMode('sniper')} className="seg-item inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"><Vault className="h-3.5 w-3.5" aria-hidden />Sniper wallet</button>
              <button type="button" role="radio" aria-checked={mode === 'wallet'} onClick={() => setMode('wallet')} className="seg-item inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"><Wallet className="h-3.5 w-3.5" aria-hidden />My wallet</button>
            </div>
            <button onClick={() => setAuto((a) => !a)} aria-pressed={auto} disabled={mode === 'wallet'} title={mode === 'wallet' ? 'Every buy from your own wallet needs your approval. Use Paper or the sniper wallet for auto sniping.' : undefined} className={`btn h-10 px-5 ${auto ? 'btn-buy' : 'btn-secondary'}`}>
              {auto ? <Pause className="h-4 w-4" weight="fill" aria-hidden /> : <Play className="h-4 w-4" weight="fill" aria-hidden />}
              {auto ? 'Auto sniping on' : 'Start auto sniping'}
            </button>
          </>
        }
      />
      {mode === 'wallet' && (() => {
        const chain = chainByKey(activeChain.key);
        const wallet = chain ? (chain.vm === 'svm' ? wallets.svm : wallets.evm) : null;
        const spend = walletSettings.spend[activeChain.key] ?? '';
        return (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <p className="eyebrow mb-1.5">Wallet on {activeChain.name}</p>
                {!chain ? (
                  <p className="text-sm text-amber-200">Arctos cannot swap on {activeChain.name} yet. Pick Solana, BNB Chain, Ethereum, Base or another swap chain, or use the paper account here.</p>
                ) : wallet ? (
                  <p className="flex items-center gap-1.5 text-sm text-zinc-200"><Wallet className="h-4 w-4 text-emerald-300" aria-hidden /><span className="num">{shortAddress(wallet.address)}</span><CopyAddress value={wallet.address} label="Copy wallet address" /></p>
                ) : chain.vm === 'svm' ? (
                  <button type="button" onClick={() => void wallets.connectSolanaWallet().catch((e) => toast.error(e instanceof Error ? e.message : 'Phantom could not connect.'))} className="btn btn-primary btn-sm">Connect Phantom</button>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(evmMenu ? WALLET_OPTIONS : WALLET_OPTIONS.slice(0, 2)).map((w) => (
                      <button key={w.id} type="button" onClick={() => void wallets.connectEvmWallet(w.id).then(() => setEvmMenu(false)).catch((e) => toast.error(e instanceof Error ? e.message : 'The wallet could not connect.'))} className="btn btn-secondary btn-sm">{w.name}</button>
                    ))}
                    {!evmMenu && <button type="button" onClick={() => setEvmMenu(true)} className="btn btn-ghost btn-sm">More</button>}
                  </div>
                )}
              </div>
              {chain && (
                <label className="block w-40">
                  <span className="eyebrow mb-1.5 block">Spend per buy</span>
                  <span className="relative block">
                    <input value={spend} inputMode="decimal" onChange={(e) => { const v = e.target.value.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 20); setWalletSettings((s) => ({ ...s, spend: { ...s.spend, [activeChain.key]: v } })); }}
                      className={`field num py-2 pr-14 ${spend && !validSpend(spend) ? 'border-rose-400/50' : ''}`} aria-label={`Amount of ${chain.native.symbol} to spend per buy`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">{chain.native.symbol}</span>
                  </span>
                </label>
              )}
              <label className="block w-28">
                <span className="eyebrow mb-1.5 block">Slippage %</span>
                <input type="number" min={0.1} max={50} step={0.5} value={walletSettings.slippagePct} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setWalletSettings((s) => ({ ...s, slippagePct: Math.min(50, Math.max(0.1, n)) })); }} className="field num py-2" aria-label="Slippage in percent" />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">Every buy and sell is a real swap through the best route (Jupiter, Relay, KyberSwap and others) and opens your wallet for approval, with the same checks as the Trading Terminal. Arctos never holds your funds or keys. Selling while you are away needs a signature, so in wallet mode your exit plan alerts you here when a target is hit and you sell with one click. New tokens are very risky: spend only what you can lose.</p>
          </Card>
        );
      })()}

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

      <Collapsible id="sniper-exit" title="Exit plan" icon={<IconTile tone="mint" size="sm"><Target /></IconTile>} summary={describePlan(exit)}>
        <ExitPlanCard bare exit={exit} onChange={setExit} keeper={paper.keeper} capability={service.data?.keeper ?? null} openCount={sniperPositions.length} />
        {mode !== 'paper' && <p className="mt-3 text-[11px] text-zinc-500">{mode === 'sniper' ? 'Sniper wallet snipes are sold by this plan automatically while this page is open and the wallet is unlocked.' : 'Snipes from your own wallet raise an alert at each target with a one click sell, since every sale needs your approval.'}</p>}
      </Collapsible>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          {mode === 'sniper' && (
            <SniperWalletCard phantom={wallets.svm} solPriceUsd={solPrice} onBalance={onSniperBalance} onEvmBalances={onEvmBalances}
              evmWallet={wallets.evm} focusChain={activeChain.key}
              onConnectEvm={(type) => void wallets.connectEvmWallet(type).catch((e) => toast.error(e instanceof Error ? e.message : 'The wallet could not connect.'))}
              onConnectPhantom={() => void wallets.connectSolanaWallet().catch((e) => toast.error(e instanceof Error ? e.message : 'Phantom could not connect.'))} />
          )}
          {mode !== 'wallet' && (
            <AutoSniperCard
              on={auto} onToggle={() => setAuto((a) => !a)} canRun={autoStartBlocked() == null} whyNot={autoStartBlocked() ? `Not ready: ${autoStartBlocked()}` : undefined}
              strategy={walletSettings.strategy} onStrategy={setStrategy}
              events={autoSniper.events} summary={autoSniper.summary} scanning={autoSniper.scanning}
              scope={(
                <div>
                  <p className="eyebrow mb-1.5">Snipe on</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chains the auto sniper covers">
                    {AUTO_CHAINS.map((k) => {
                      const c = chains.find((x) => x.key === k);
                      if (!c) return null;
                      const on = walletSettings.autoChains.includes(k);
                      const why = mode === 'sniper' && on ? sniperNotReady(k) : null;
                      return (
                        <button key={k} type="button" aria-pressed={on} onClick={() => toggleAutoChain(k)} title={why ? `Not ready: ${why}` : undefined} className={chip(on)}>
                          {c.name}{why ? ' (not ready)' : ''}
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    Most snipes open at once
                    <input type="number" min={1} max={MAX_OPEN_LIMIT} step={1} value={walletSettings.maxOpen}
                      onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) setWalletSettings((s) => ({ ...s, maxOpen: Math.min(MAX_OPEN_LIMIT, Math.max(1, n)) })); }}
                      className="field num w-20 py-1.5" aria-label="Most snipes open at once" />
                    <span className={atLimit ? 'text-amber-200' : 'text-zinc-500'}>{openSnipes} open now{atLimit ? ', so buying waits until one is sold' : ''}</span>
                  </label>
                </div>
              )}
              budget={mode === 'paper' ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="eyebrow mb-1 block">Budget for auto snipes ($)</span>
                    <input type="number" min={10} step={50} value={walletSettings.paperBudgetUsd} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setWalletSettings((s) => ({ ...s, paperBudgetUsd: Math.min(1e7, Math.max(10, n)) })); }} className="field num py-2" />
                  </label>
                  <label className="block"><span className="eyebrow mb-1 block">Per snipe ($)</span>
                    <input type="number" min={1} step={10} value={filters.maxPositionUsd} onChange={(e) => setFilter('maxPositionUsd', e.target.value, 1e7)} className="field num py-2" />
                  </label>
                  <p className="col-span-2 text-[11px] text-zinc-500">{formatDollars(paperInSnipes, 0)} of {formatDollars(walletSettings.paperBudgetUsd, 0)} is in open snipes. The auto sniper never goes over the budget.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(walletSettings.autoChains.includes('solana') || activeChain.key === 'solana') && (
                    <label className="block"><span className="eyebrow mb-1 block">Spend per buy (SOL)</span>
                      <input value={walletSettings.sniperSpend} inputMode="decimal" onChange={(e) => { const v = e.target.value.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 12); setWalletSettings((s) => ({ ...s, sniperSpend: v })); }} className="field num py-2" />
                    </label>
                  )}
                  {[...new Set([...walletSettings.autoChains, activeChain.key])].filter((k) => chainByKey(k)?.vm === 'evm').map((k) => {
                    const c = chainByKey(k);
                    if (!c) return null;
                    return (
                      <label key={k} className="block"><span className="eyebrow mb-1 block">Spend per buy on {c.name} ({c.native.symbol})</span>
                        <input value={walletSettings.sniperSpendEvm[k] ?? ''} inputMode="decimal" onChange={(e) => { const v = e.target.value.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 12); setWalletSettings((s) => ({ ...s, sniperSpendEvm: { ...s.sniperSpendEvm, [k]: v } })); }} className="field num py-2" />
                      </label>
                    );
                  })}
                  <label className="block"><span className="eyebrow mb-1 block">Slippage %</span>
                    <input type="number" min={0.1} max={50} step={0.5} value={walletSettings.slippagePct} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setWalletSettings((s) => ({ ...s, slippagePct: Math.min(50, Math.max(0.1, n)) })); }} className="field num py-2" />
                  </label>
                  <p className="col-span-2 text-[11px] text-zinc-500">The budget is what you deposit into the sniper wallets. Each chain stops buying when its balance runs low, and the others carry on.</p>
                </div>
              )}
            />
          )}
          {mode !== 'paper' && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Wallet /></IconTile>{mode === 'sniper' ? 'Sniper wallet snipes' : 'Wallet snipes'}</h2>
              {walletSnipes.filter((w) => (mode === 'sniper') === (w.source === 'sniper')).length === 0 ? (
                <p className="text-xs text-zinc-500">Tokens you buy here show up with their live profit and loss{mode === 'sniper' ? ', and are sold by your exit plan automatically.' : ', your exit plan alerts and one click sells.'}</p>
              ) : (
                <ul className="space-y-2.5">
                  {walletSnipes.filter((w) => (mode === 'sniper') === (w.source === 'sniper')).map((w) => {
                    const price = walletPrice(w.id);
                    const gain = price != null ? (price / w.entryPriceUsd - 1) * 100 : null;
                    const hits = gain == null ? [] : [
                      ...exit.takeProfits.map((tp, i) => (tp.enabled && gain >= tp.gainPct ? `Take profit ${i + 1} reached` : '')),
                      exit.stopLossPct > 0 && gain <= -exit.stopLossPct ? 'Stop loss reached' : '',
                    ].filter(Boolean);
                    return <WalletSnipeRow key={w.id} snipe={w} price={price} alerts={hits} onSell={(f) => (w.source === 'sniper' ? void sniperSellSnipe(w, f, 'sold by you') : walletSell(w, f))} onForget={() => setWalletSnipes((list) => list.filter((x) => x.id !== w.id))} />;
                  })}
                </ul>
              )}
            </Card>
          )}
          <Collapsible id="sniper-results" title={mode === 'paper' ? 'Measured results' : 'Paper results'} icon={<IconTile tone="mint" size="sm"><Trophy /></IconTile>}
            summary={record.winRatePct == null ? 'No closed snipes yet' : `Win rate ${record.winRatePct.toFixed(0)}%, ${record.closed} closed`} defaultOpen>
            <p className="mb-4 text-[11px] leading-relaxed text-zinc-500">The sniper's real record from paper snipes that were sold out completely. A snipe sold in steps counts once. No filter can guarantee a win rate, so judge it on these numbers.</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Win rate</dt><dd className="num text-xl font-semibold text-white">{record.winRatePct == null ? 'No data' : `${record.winRatePct.toFixed(0)}%`}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Closed snipes</dt><dd className="num text-xl font-semibold text-white">{record.closed}{record.closed > 0 && <span className="text-xs text-zinc-500"> ({record.wins} won)</span>}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Realised profit</dt><dd className={`num text-xl font-semibold ${record.closed ? pnlClass(record.realizedUsd) : 'text-white'}`}>{formatDollars(record.realizedUsd)}</dd></div>
              <div className="panel-inset p-3"><dt className="eyebrow text-[10px]">Open snipes</dt><dd className="num text-xl font-semibold text-white">{sniperPositions.length}</dd></div>
            </dl>
            <dl className="mt-3 space-y-1.5 text-xs">
              {[
                ['Tokens in this feed', String(tokens.length)], ['Fully checked', String(feed.data?.checked ?? 0)],
                ['Passing your filters', String(passing.length)], ['Developers on record', String(feed.data?.developersKnown ?? 0)],
                ['Paper cash', formatDollars(paper.availableCash)],
              ].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-zinc-500">{k}</dt><dd className="num font-medium text-zinc-200">{v}</dd></div>)}
            </dl>
          </Collapsible>

          {sniperPositions.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold text-white">Open snipes</h2>
              <ul className="space-y-2.5">
                {sniperPositions.map((p) => (
                  <OpenSnipe
                    key={p.key} position={p} exit={exit} rejected={paper.keeper.rejected[p.key]}
                    onSell={() => {
                      if (!p.price) return toast.error('No live price yet.');
                      const r = paper.sellMarket(p.key, p.qty, p.price);
                      if (!r.ok) toast.error(r.error);
                      else toast.success(`Sold ${p.symbol}`);
                    }}
                  />
                ))}
              </ul>
            </Card>
          )}

          <Collapsible id="sniper-filters" title="My filters" icon={<IconTile tone="amber" size="sm"><FunnelSimple /></IconTile>} summary="Used by the My filters auto mode and the Passes your filters badge">
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
          </Collapsible>
        </div>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Token lists" className="seg">
              {([['new', 'Just launched'], ['active', 'Most active'], ['dex', 'DexScreener'], ['tracked', `Tracked (${tracked.length})`]] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="seg-item inline-flex items-center gap-1">{id === 'dex' && <Fire className="h-3.5 w-3.5 text-amber-300" weight="fill" aria-hidden />}{label}</button>
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
                {results.map((t) => <BasicCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} buy={buyFor(t)} />)}
              </div>
            </div>
          )}

          {tab === 'dex' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist" aria-label="DexScreener lists">
                  {DEX_VIEWS.map(([id, label]) => <button key={id} role="tab" aria-selected={dexView === id} onClick={() => setDexView(id)} className={chip(dexView === id)}>{label}</button>)}
                </div>
                {dexList && (
                  <div className="seg ml-auto flex" role="radiogroup" aria-label="Chains shown">
                    <button type="button" role="radio" aria-checked={!dexAllChains} onClick={() => setDexAllChains(false)} className="seg-item px-2.5 py-1 text-xs">{activeChain.name}</button>
                    <button type="button" role="radio" aria-checked={dexAllChains} onClick={() => setDexAllChains(true)} className="seg-item px-2.5 py-1 text-xs">All chains</button>
                  </div>
                )}
              </div>
              {dexView === 'live' ? (
                <div className="-mx-5 border-y border-white/[0.06]"><DexScreenerEmbed initialSlug={chainByKey(activeChain.key)?.dexscreener ?? activeChain.key} hint="To snipe a token you find here, search for it above by name or contract address." /></div>
              ) : dexView === 'metas' ? (
                <>
                  <p className="text-xs text-zinc-500">Metas are the narratives traders are piling into right now, with their total market cap and how it moved. Pick one to see its biggest tokens.</p>
                  {metas.loading && !metas.data ? <Loading label="Loading DexScreener metas" /> : metas.error && !metas.data ? <ErrorNotice message={metas.error} onRetry={metas.refresh} /> : <MetasGrid metas={metas.data?.metas ?? []} selected={metaSlug} onPick={(slug) => setMetaSlug((s) => (s === slug ? null : slug))} />}
                  {metaSlug && (metaTokens.loading && !metaTokens.data ? <Loading label="Loading the meta's tokens" />
                    : metaTokens.error && !metaTokens.data ? <ErrorNotice message={metaTokens.error} onRetry={metaTokens.refresh} />
                    : (
                      <div className="space-y-3">
                        <p className="eyebrow">Biggest tokens in {metaTokens.data?.meta.name ?? 'this meta'}</p>
                        {dexTokens.length === 0 && <p className="text-sm text-zinc-500">None of this meta's tokens are on a chain the sniper covers.</p>}
                        {dexTokens.map((t) => <BasicCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} buy={buyFor(t)} />)}
                      </div>
                    ))}
                </>
              ) : discover.loading && !discover.data ? <Loading label="Loading from DexScreener" />
              : discover.error && !discover.data ? <ErrorNotice message={discover.error} onRetry={discover.refresh} />
              : dexTokens.length === 0 ? <Empty title={`Nothing on this list for ${dexAllChains ? 'the covered chains' : activeChain.name} right now`}>Try All chains, or another list.</Empty>
              : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500">{dexView === 'boosted' ? 'Tokens with the most DexScreener boosts. Boosts are paid promotion, so judge them on liquidity, buyers and the risk check.' : dexView === 'profiles' ? 'Tokens whose teams just published a DexScreener profile, usually brand new.' : 'Community takeovers: tokens whose holders took over after the team left.'}</p>
                  {dexTokens.map((t) => <BasicCard key={t.id} token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} onTrack={track} tracked={tracked.some((x) => x.id === t.id)} buy={buyFor(t)} extra={<DiscoverExtra token={t} />} />)}
                </div>
              )}
            </div>
          ) : tab === 'tracked' ? (
            trackedTokens.length === 0 ? (
              <Empty title="You are not tracking any tokens">Press the plus button on any token to follow its live price here.</Empty>
            ) : (
              <div className="space-y-3">
                {trackedTokens.map((t) => (
                  <div key={t.id} className="relative">
                    <BasicCard token={t} security={security[t.id]} filters={filters} held={Boolean(paper.account.positions[t.id])} onSnipe={snipe} tracked buy={buyFor(t)} />
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
                  <FeedCard key={t.id} token={t} filters={filters} riskChecks={activeChain.riskChecks} held={Boolean(paper.account.positions[t.id])} tracked={tracked.some((x) => x.id === t.id)} onSnipe={snipe} onTrack={track} buy={buyFor(t)} strategy={walletSettings.strategy} />
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
      {quick && (
        <Suspense fallback={null}>
          <QuickSwap request={quick} wallets={wallets} onClose={() => setQuick(null)} onDone={onQuickDone} />
        </Suspense>
      )}
    </div>
  );
}
