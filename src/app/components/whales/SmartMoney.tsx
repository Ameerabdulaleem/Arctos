import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, ArrowsLeftRight, Brain, CircleNotch, Crown, Info, Lightning, Star, Wallet } from '@phosphor-icons/react';
import { usePolling } from '../../hooks/usePolling';
import { errorMessage, isAbort } from '../../services/api';
import { portfolioService, type PortfolioResponse } from '../../services/portfolioService';
import { SMART_CHAINS, smartMoneyService, type Grade, type SmartChain, type SmartPosition, type SmartWallet } from '../../services/smartMoneyService';
import { loadPnlReport, type PnlReport } from '../../lib/walletPnlReport';
import { swapHref, walletUrl } from '../../lib/tokenLinks';
import { formatCompactUsd, formatNumber, formatPct, formatPrice, formatUsd, pnlClass, shortAddress, timeAgo } from '../../lib/format';
import { Card, Empty, ErrorNotice, Loading, Pill } from '../ui/common';
import { CopyAddress } from '../ui/CopyAddress';
import { TokenLinks } from '../ui/TokenLinks';
import { TokenLogo } from '../ui/TokenLogo';

const CHAIN_KEY = 'arctos_smart_chain';

const GRADE_STYLE: Record<Grade, string> = {
  A: 'border-emerald-300/50 bg-emerald-400/15 text-emerald-200',
  B: 'border-blue-300/50 bg-blue-400/15 text-blue-200',
  C: 'border-amber-300/40 bg-amber-400/10 text-amber-200',
  D: 'border-white/15 bg-white/[0.05] text-zinc-400',
};

type Sort = 'score' | 'pnl' | 'winRate' | 'roi';
const SORTS: Array<[Sort, string]> = [['score', 'Best grade'], ['pnl', 'Profit'], ['winRate', 'Win rate'], ['roi', 'Return']];

function readChain(): SmartChain {
  try {
    const v = localStorage.getItem(CHAIN_KEY);
    return SMART_CHAINS.some((c) => c.key === v) ? (v as SmartChain) : 'solana';
  } catch {
    return 'solana';
  }
}

function GradeBadge({ grade, large = false }: { grade: Grade; large?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-lg border font-bold ${GRADE_STYLE[grade]} ${large ? 'h-11 w-11 text-xl' : 'h-8 w-8 text-sm'}`} title={`Grade ${grade}`}>{grade}</span>;
}

function SwapLink({ chain, address, symbol }: { chain: string; address: string; symbol: string }) {
  const href = swapHref(chain, address);
  if (!href) return null;
  return <a href={href} className="btn btn-secondary btn-sm shrink-0" aria-label={`Swap for ${symbol}`}><ArrowsLeftRight className="h-3.5 w-3.5" aria-hidden />Swap</a>;
}

function WalletRow({ w, selected, tracked, onSelect }: { w: SmartWallet; selected: boolean; tracked: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-blue-300/50 bg-blue-400/[0.07]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15'}`}>
        <div className="flex items-center gap-3">
          <GradeBadge grade={w.grade} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <span className="num">{shortAddress(w.address, 5, 5)}</span>
              {tracked && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Tracked" />}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
              <span>Won <span className="num text-zinc-200">{w.wins}</span> of <span className="num text-zinc-200">{w.tokens}</span></span>
              <span>Win rate <span className="num text-zinc-200">{w.winRatePct.toFixed(0)}%</span></span>
              {w.earlyHits > 0 && <span className="text-emerald-300"><Lightning className="inline h-3 w-3" aria-hidden /> {w.earlyHits} early</span>}
            </p>
          </div>
          <div className="text-right">
            <p className={`num text-sm font-semibold ${pnlClass(w.pnlUsd)}`}>{formatCompactUsd(w.pnlUsd)}</p>
            <p className={`num text-[11px] ${pnlClass(w.roiPct)}`}>{formatPct(w.roiPct, 0)}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {w.positions.slice(0, 4).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-zinc-300">
              <TokenLogo src={p.imageUrl} symbol={p.symbol} size={14} />{p.symbol}
              <span className={`num ${pnlClass(p.pnlUsd)}`}>{p.multiple >= 1 ? `${p.multiple.toFixed(1)}x` : formatPct(p.roiPct, 0)}</span>
            </span>
          ))}
        </div>
      </button>
    </li>
  );
}

function PositionRow({ p }: { p: SmartPosition }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <TokenLogo src={p.imageUrl} symbol={p.symbol} size={28} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-white">{p.symbol}</span>
          <span className="num text-[11px] text-zinc-500">{shortAddress(p.address, 4, 4)}</span>
          <TokenLinks chain={p.chain} address={p.address} symbol={p.symbol} pairUrl={p.url} />
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
          <span>In at <span className="num text-zinc-300">{formatPrice(p.entryPrice)}</span></span>
          <span>Now <span className="num text-zinc-300">{formatPrice(p.priceUsd)}</span></span>
          <span>Put in <span className="num text-zinc-300">{formatCompactUsd(p.boughtUsd)}</span></span>
          <span>{p.heldPct >= 99 ? 'Still holds all' : p.heldPct <= 1 ? 'Sold out' : `Still holds ${p.heldPct.toFixed(0)}%`}</span>
          {p.firstBuyAt > 0 && <span>bought {timeAgo(p.firstBuyAt)}</span>}
        </p>
      </div>
      <div className="text-right">
        <p className={`num text-sm font-semibold ${pnlClass(p.pnlUsd)}`}>{formatCompactUsd(p.pnlUsd)}</p>
        <p className={`num text-[11px] ${pnlClass(p.roiPct)}`}>{p.multiple > 0 ? `${p.multiple.toFixed(2)}x` : '—'}</p>
      </div>
    </li>
  );
}

/** What the wallet holds now, read from the chain. */
function Holdings({ address, scanned }: { address: string; scanned: Set<string> }) {
  const [state, setState] = useState<{ data: PortfolioResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  // Mounted afresh for each wallet (keyed by address), so it starts out loading.
  useEffect(() => {
    const c = new AbortController();
    portfolioService.get(address, c.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => { if (!isAbort(e)) setState({ data: null, error: errorMessage(e), loading: false }); });
    return () => c.abort();
  }, [address]);

  if (state.loading) return <Loading label="Reading what this wallet holds" />;
  if (state.error) return <p role="alert" className="text-sm text-amber-200">{state.error}</p>;
  const holdings = (state.data?.holdings ?? []).filter((h) => (h.valueUsd ?? 0) >= 1 || h.kind === 'native').slice(0, 25);
  if (!holdings.length) return <p className="text-sm text-zinc-500">No holdings worth a dollar or more.</p>;
  return (
    <>
      <p className="mb-1 text-[11px] text-zinc-500">Worth <span className="num text-zinc-200">{formatUsd(state.data?.totalUsd ?? 0)}</span> in total{state.data?.hiddenTokens ? `, plus ${state.data.hiddenTokens} small or unpriced tokens` : ''}.</p>
      <ul className="divide-y divide-white/[0.05]">
        {holdings.map((h) => (
          <li key={`${h.chain}:${h.address ?? h.symbol}`} className="flex items-center gap-3 py-2">
            <TokenLogo src={h.logo} symbol={h.symbol} size={26} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-semibold text-white">{h.symbol}</span>
                {h.address && scanned.has(h.address.toLowerCase()) && <Pill tone="green">Pumping now</Pill>}
                {h.address && <TokenLinks chain={h.chain} address={h.address} symbol={h.symbol} />}
              </p>
              <p className="num text-[11px] text-zinc-500">{formatNumber(h.amount, 4)} {h.change24h != null && <span className={pnlClass(h.change24h)}>{formatPct(h.change24h, 1)} 24h</span>}</p>
            </div>
            <span className="num text-sm text-zinc-200">{h.valueUsd == null ? 'No price' : formatUsd(h.valueUsd)}</span>
            {h.address && <SwapLink chain={h.chain} address={h.address} symbol={h.symbol} />}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The wallet's whole recent history, graded the way the Trade Book grades your own wallet. */
function FullGrade({ address }: { address: string }) {
  const [report, setReport] = useState<PnlReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const r = await loadPnlReport(address, { limit: 300, deep: false, signal: c.signal, onProgress: (done, total) => setProgress({ done, total }) });
      if (!c.signal.aborted) setReport(r);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'The wallet history could not be read.');
    } finally {
      if (!c.signal.aborted) setProgress(null);
    }
  };

  if (!report) {
    return (
      <div className="panel-inset p-3">
        <p className="text-xs text-zinc-400">Grade this wallet on its last 300 transactions, every token it traded, not only the ones scanned here.</p>
        <button type="button" onClick={() => void run()} disabled={progress != null} className="btn btn-secondary btn-sm mt-2">
          {progress ? <CircleNotch className="h-4 w-4 animate-spin" aria-hidden /> : <Brain className="h-4 w-4" aria-hidden />}
          {progress ? `Reading${progress.total ? ` ${progress.done} of ${progress.total}` : '…'}` : 'Grade its full history'}
        </button>
        {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    );
  }
  const t = report.pnl.totals;
  return (
    <div className="panel-inset grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4">
      <p><span className="block text-zinc-500">Net P/L</span><span className={`num text-sm font-semibold ${pnlClass(t.netUsd)}`}>{formatUsd(t.netUsd)}</span></p>
      <p><span className="block text-zinc-500">Win rate</span><span className="num text-sm font-semibold text-white">{t.winRatePct == null ? 'No sells' : `${t.winRatePct.toFixed(0)}%`}</span></p>
      <p><span className="block text-zinc-500">Trades</span><span className="num text-sm font-semibold text-white">{t.trades}</span></p>
      <p><span className="block text-zinc-500">Since</span><span className="text-sm text-white">{t.since ? new Date(t.since).toLocaleDateString() : '—'}</span></p>
      <p className="col-span-full text-[11px] text-zinc-500">From its last {report.scanned} transactions: {formatUsd(t.profitUsd)} won, {formatUsd(t.lossUsd)} lost, {report.pnl.tokens.filter((k) => !k.noTrade).length} tokens traded.</p>
    </div>
  );
}

function WalletDetail({ w, tracked, onTrack, scanned }: { w: SmartWallet; tracked: boolean; onTrack: () => void; scanned: Set<string> }) {
  const explorer = walletUrl(w.chain, w.address);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <GradeBadge grade={w.grade} large />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1 font-semibold text-white">
            <span className="num">{shortAddress(w.address, 6, 6)}</span>
            <CopyAddress value={w.address} label="Copy the wallet address" />
            {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" aria-label="Open the wallet in the explorer" title="Open the wallet" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.08] hover:text-white"><ArrowSquareOut className="h-3.5 w-3.5" /></a>}
          </p>
          <p className="text-xs text-zinc-500">{SMART_CHAINS.find((c) => c.key === w.chain)?.name}, last bought {w.lastActive ? timeAgo(w.lastActive) : 'recently'}</p>
        </div>
        <button type="button" onClick={onTrack} disabled={tracked} className="btn btn-secondary btn-sm"><Star className={`h-4 w-4 ${tracked ? 'fill-amber-300 text-amber-300' : ''}`} aria-hidden />{tracked ? 'Tracked' : 'Track'}</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Profit', formatCompactUsd(w.pnlUsd), pnlClass(w.pnlUsd)],
          ['Return', formatPct(w.roiPct, 0), pnlClass(w.roiPct)],
          ['Win rate', `${w.winRatePct.toFixed(0)}%`, 'text-white'],
          ['Early entries', String(w.earlyHits), 'text-white'],
        ].map(([k, v, tone]) => (
          <div key={k} className="panel-inset p-2.5"><p className="eyebrow text-[10px]">{k}</p><p className={`num text-base font-semibold ${tone}`}>{v}</p></div>
        ))}
      </div>

      <section>
        <h3 className="text-sm font-semibold text-white">Its trades in the tokens scanned</h3>
        <ul className="divide-y divide-white/[0.05]">{w.positions.map((p) => <PositionRow key={p.id} p={p} />)}</ul>
      </section>

      {w.chain === 'solana' && <FullGrade key={w.address} address={w.address} />}

      <section>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white"><Wallet className="h-4 w-4 text-zinc-400" aria-hidden />What it holds now</h3>
        <Holdings key={w.address} address={w.address} scanned={scanned} />
      </section>
    </Card>
  );
}

/** Wallets that bought legit tokens before they pumped, graded on how often and how much they won. */
export function SmartMoney({ isTracked, onTrack }: { isTracked: (address: string) => boolean; onTrack: (address: string, label: string) => void }) {
  const [chain, setChain] = useState<SmartChain>(readChain);
  const [grade, setGrade] = useState<'all' | Grade>('all');
  const [sort, setSort] = useState<Sort>('score');
  const [selected, setSelected] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const data = usePolling((s) => smartMoneyService.get(chain, s), 5 * 60_000, [chain]);

  const changeChain = (next: SmartChain) => {
    setChain(next);
    setSelected(null);
    try { localStorage.setItem(CHAIN_KEY, next); } catch { /* storage unavailable */ }
  };

  const scan = data.data?.chain === chain ? data.data : null;
  const wallets = useMemo(() => {
    const list = (scan?.wallets ?? []).filter((w) => grade === 'all' || w.grade === grade);
    const key: Record<Sort, (w: SmartWallet) => number> = { score: (w) => w.score, pnl: (w) => w.pnlUsd, winRate: (w) => w.winRatePct * 1000 + w.wins, roi: (w) => w.roiPct };
    return sort === 'score' ? list : [...list].sort((a, b) => key[sort](b) - key[sort](a));
  }, [scan, grade, sort]);
  const scanned = useMemo(() => new Set((scan?.tokens ?? []).map((t) => t.address.toLowerCase())), [scan]);
  const counts = useMemo(() => {
    const c: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const w of scan?.wallets ?? []) c[w.grade] += 1;
    return c;
  }, [scan]);
  const active = wallets.find((w) => w.address === selected) ?? null;

  const pick = (address: string) => {
    setSelected(address);
    // On a phone the details sit under the list.
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 1023px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="seg flex" role="tablist" aria-label="Chain">
          {SMART_CHAINS.map((c) => <button key={c.key} type="button" role="tab" aria-selected={chain === c.key} onClick={() => changeChain(c.key)} className="seg-item px-3 py-1 text-xs">{c.name}</button>)}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Grade">
          {(['all', 'A', 'B', 'C'] as const).map((g) => (
            <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${grade === g ? 'border border-blue-300/40 bg-blue-400/15 text-blue-100' : 'border border-white/[0.07] bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white'}`}>
              {g === 'all' ? 'All grades' : `${g} (${counts[g]})`}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-500">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white">
            {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </Card>

      {data.error && <ErrorNotice message={data.error} onRetry={data.refresh} />}

      {scan && scan.tokens.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-xs text-zinc-400"><Crown className="h-4 w-4 text-amber-300" aria-hidden /><span>Pumping tokens whose whale trades were read{scan.updatedAt ? <span className="text-zinc-500">{`, updated ${timeAgo(scan.updatedAt)}`}</span> : null}</span></p>
          <ul className="flex flex-wrap gap-2">
            {scan.tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs">
                <TokenLogo src={t.imageUrl} symbol={t.symbol} size={18} />
                <span className="font-semibold text-white">{t.symbol}</span>
                {t.change24h != null && <span className={`num ${pnlClass(t.change24h)}`}>{formatPct(t.change24h, 0)}</span>}
                <span className="text-zinc-500">{t.whales} whales</span>
                <TokenLinks chain={t.chain} address={t.address} symbol={t.symbol} pairUrl={t.url} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <Card className="p-4">
          {data.loading && !scan ? <Loading label="Reading the whale trades of pumping tokens. The first scan takes about half a minute." />
          : wallets.length === 0 ? (
            <Empty title="No graded wallets yet">{scan ? 'No wallet in profit matched this grade. Try All grades or another chain.' : 'The scan could not run just now. It retries on its own.'}</Empty>
          ) : (
            <ul className="space-y-2">
              {wallets.map((w) => <WalletRow key={w.address} w={w} selected={w.address === selected} tracked={isTracked(w.address)} onSelect={() => pick(w.address)} />)}
            </ul>
          )}
        </Card>
        <div ref={detailRef} className="lg:sticky lg:top-4 lg:self-start">
          {active ? (
            <WalletDetail w={active} scanned={scanned} tracked={isTracked(active.address)} onTrack={() => onTrack(active.address, `Smart money ${active.grade} ${shortAddress(active.address, 4, 4)}`)} />
          ) : (
            <Card className="p-5">
              <p className="flex items-center gap-2 font-semibold text-white"><Info className="h-4 w-4 text-blue-300" aria-hidden />How wallets are graded</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-400">
                <li>The tokens trending on the chain are read, and the legit ones (real liquidity and volume) that rose most are picked, along with a few that did not, so losses count too.</li>
                <li>Every trade of {formatCompactUsd(scan?.minTradeUsd ?? 300)} or more in them is read. Each wallet's entry price is set against today's price.</li>
                <li>Bots that trade dozens of times or buy and sell in the same second are left out.</li>
                <li><b className="text-emerald-300">A</b>: won on two or more tokens, three in four or better, with an early entry. <b className="text-blue-300">B</b>: won on two, or got in early on one for double or more. <b className="text-amber-300">C</b>: in profit on at least one.</li>
              </ul>
              <p className="mt-3 text-sm text-zinc-300">Pick a wallet to see its trades, what it holds now, and to grade its full history.</p>
            </Card>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-500">Trades come from GeckoTerminal, refreshed every few minutes. A grade reflects the tokens read so far, not advice. Check a token on DexScreener before buying.</p>
    </div>
  );
}
