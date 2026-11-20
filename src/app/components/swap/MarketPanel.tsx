import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowSquareOut, ChartLineUp, CircleNotch, DiscordLogo, FacebookLogo, Fire, GithubLogo, Globe, Info, InstagramLogo, LinkSimple,
  MagnifyingGlass, RedditLogo, TelegramLogo, TiktokLogo, XLogo, YoutubeLogo,
} from '@phosphor-icons/react';
import { chainById, isNative, tokenUrl, type SwapChain } from '../../swap/chains';
import { chainForSlug, PERIODS, searchDex, tokenPairs, type DexLink, type DexPair } from '../../swap/dexscreener';
import type { Token } from '../../swap/types';
import { formatCompactUsd, formatNumber, formatPct, formatPrice, pnlClass, shortAddress, timeAgo } from '../../lib/format';
import { Card } from '../ui/common';
import { DexScreenerEmbed } from '../DexScreenerEmbed';
import { CopyAddress } from '../ui/CopyAddress';

type View = 'chart' | 'info' | 'screener';

/** The pools of the token being charted, deepest first. */
function useTokenPairs(token: Token | null) {
  const chain = token ? chainById(token.chainId) : undefined;
  const address = token && chain ? (isNative(chain, token.address) ? chain.wrapped : token.address) : null;
  const key = chain && address ? `${chain.dexscreener}:${address}` : '';
  const [state, setState] = useState<{ key: string; pairs: DexPair[]; error: string | null } | null>(null);

  useEffect(() => {
    if (!chain || !address) return;
    let live = true;
    tokenPairs(chain.dexscreener, address)
      .then((pairs) => live && setState({ key, pairs, error: pairs.length ? null : 'DexScreener has no pool for this token yet.' }))
      .catch((e) => live && setState({ key, pairs: [], error: e instanceof Error ? e.message : 'DexScreener could not be reached.' }));
    return () => {
      live = false;
    };
  }, [key, chain, address]);

  const current = state?.key === key ? state : null;
  return { chain, address, pairs: current?.pairs ?? [], error: current?.error ?? null, loading: Boolean(key) && !current };
}

// ------------------------------------------------------------------ search

function DexSearch({ onPick }: { onPick: (chain: SwapChain, address: string) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ q: string; list: DexPair[]; error: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const q = text.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchDex(q)
        .then((list) => live && setState({ q, list: list.slice(0, 14), error: null }))
        .catch((e) => live && setState({ q, list: [], error: e instanceof Error ? e.message : 'Search failed.' }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const results = state?.q === q ? state : null;
  const pick = (p: DexPair) => {
    const chain = chainForSlug(p.chain);
    if (!chain) return;
    onPick(chain, p.base.address);
    setOpen(false);
    setText('');
  };

  return (
    <div ref={box} className="relative">
      <label className="relative block">
        <span className="sr-only">Search tokens on DexScreener</span>
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          value={text} onChange={(e) => { setText(e.target.value.slice(0, 64)); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && results?.list[0]) pick(results.list[0]); }}
          placeholder="Search any token by name, symbol or contract address" className="field py-2.5 pl-9" spellCheck={false} autoComplete="off"
          aria-expanded={open && q.length >= 2} aria-controls="dex-search-results" role="combobox"
        />
      </label>
      {open && q.length >= 2 && (
        <div id="dex-search-results" role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur">
          {!results && <p className="flex items-center gap-2 px-3 py-4 text-sm text-zinc-400"><CircleNotch className="h-4 w-4 animate-spin" aria-hidden />Searching DexScreener…</p>}
          {results?.error && <p className="px-3 py-4 text-sm text-rose-300">{results.error}</p>}
          {results && !results.error && results.list.length === 0 && <p className="px-3 py-4 text-sm text-zinc-500">Nothing found on the chains Arctos can swap.</p>}
          {results?.list.map((p) => {
            const chain = chainForSlug(p.chain);
            return (
              <div key={`${p.chain}:${p.base.address}`} role="option" aria-selected={false} tabIndex={0}
                onClick={() => pick(p)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p); } }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition hover:bg-white/[0.06] focus-visible:bg-white/[0.08]">
                <TokenImage src={p.imageUrl} symbol={p.base.symbol} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    <span className="truncate">{p.base.symbol}</span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-px text-[10px] font-medium text-zinc-400">{chain?.name ?? p.chain}</span>
                    <CopyAddress value={p.base.address} label={`Copy ${p.base.symbol} contract address`} />
                  </p>
                  <p className="truncate text-xs text-zinc-500">{p.base.name}{p.createdAt ? `, ${timeAgo(p.createdAt)}` : ''}</p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="num text-white">{formatPrice(p.priceUsd)}</p>
                  <p className="num"><span className={pnlClass(p.change.h24)}>{formatPct(p.change.h24, 1)}</span> <span className="text-zinc-500">mcap {formatCompactUsd(p.marketCap ?? p.fdv)}, liq {formatCompactUsd(p.liquidityUsd)}</span></p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TokenImage({ src, symbol, size }: { src: string | null; symbol: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white/5" style={{ width: size, height: size }} />;
  }
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400/30 to-violet-400/30 text-[10px] font-bold text-white" style={{ width: size, height: size }} aria-hidden>{symbol.slice(0, 3).toUpperCase()}</span>;
}

// ------------------------------------------------------------------ chart

function ChartView({ token, chain, pair, error }: { token: Token | null; chain?: SwapChain; pair: DexPair | null; error: string | null }) {
  const src = pair && chain
    ? `https://dexscreener.com/${chain.dexscreener}/${pair.pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`
    : null;
  return (
    <div className="relative h-[420px] bg-black/30 sm:h-[520px] xl:h-[600px]">
      {src ? (
        <iframe key={src} src={src} title={`${token?.symbol ?? 'Token'} chart on DexScreener`} className="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
          {!token ? 'Choose the token you want to receive and its live chart appears here.' : error ?? 'Finding the deepest pool on DexScreener…'}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ info

const SOCIAL_ICONS: Record<string, typeof Globe> = {
  twitter: XLogo, x: XLogo, telegram: TelegramLogo, discord: DiscordLogo, github: GithubLogo, youtube: YoutubeLogo,
  instagram: InstagramLogo, tiktok: TiktokLogo, reddit: RedditLogo, facebook: FacebookLogo, website: Globe,
};

function LinkChip({ link }: { link: DexLink }) {
  const Icon = SOCIAL_ICONS[link.type] ?? LinkSimple;
  const label = link.type === 'website' ? link.label : link.type === 'twitter' ? 'X (Twitter)' : link.type.charAt(0).toUpperCase() + link.type.slice(1);
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" title={link.url}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-blue-300/40 hover:text-white">
      <Icon className="h-3.5 w-3.5" weight="fill" aria-hidden />{label}
    </a>
  );
}

function Stat({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <dt className="eyebrow text-[10px]">{k}</dt>
      <dd className="num text-sm font-semibold text-white">{children}</dd>
    </div>
  );
}

const PERIOD_LABEL = { m5: '5m', h1: '1h', h6: '6h', h24: '24h' } as const;

function InfoView({ token, chain, pairs, error, loading }: { token: Token | null; chain?: SwapChain; pairs: DexPair[]; error: string | null; loading: boolean }) {
  const pair = pairs[0];
  if (!token || !chain) return <p className="p-6 text-sm text-zinc-500">Pick a token to see its details.</p>;
  if (!pair) return <p className="flex items-center gap-2 p-6 text-sm text-zinc-500">{loading && <CircleNotch className="h-4 w-4 animate-spin" aria-hidden />}{loading ? 'Loading token details…' : error}</p>;
  const native = isNative(chain, token.address);
  const contract = native ? null : pair.base.address;
  const links = [...pair.websites, ...pair.socials];
  const totalLiquidity = pairs.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);

  return (
    <div className="max-h-[600px] space-y-4 overflow-y-auto p-4">
      {pair.header && <img src={pair.header} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-24 w-full rounded-xl object-cover sm:h-32" />}
      <div className="flex items-center gap-3">
        <TokenImage src={pair.imageUrl} symbol={pair.base.symbol} size={44} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{pair.base.name || token.name} <span className="text-sm font-normal text-zinc-400">{pair.base.symbol}</span></p>
          <p className="text-xs text-zinc-500">{chain.name}, top pool on {pair.dexId}{pair.labels.length ? ` (${pair.labels.join(', ')})` : ''}{pair.createdAt ? `, created ${timeAgo(pair.createdAt)}` : ''}</p>
        </div>
      </div>

      {links.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">{links.map((l) => <LinkChip key={l.url} link={l} />)}</div>
      ) : (
        <p className="text-xs text-zinc-500">This token has not added a website or social accounts on DexScreener.</p>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat k="Price">{formatPrice(pair.priceUsd)}</Stat>
        <Stat k={`Price in ${pair.quote.symbol || 'quote'}`}>{pair.priceNative == null ? '—' : formatNumber(pair.priceNative, 10)}</Stat>
        <Stat k="Liquidity">{formatCompactUsd(pair.liquidityUsd)}</Stat>
        <Stat k="Market cap">{formatCompactUsd(pair.marketCap)}</Stat>
        <Stat k="FDV">{formatCompactUsd(pair.fdv)}</Stat>
        <Stat k="Pools">{pairs.length}{pairs.length > 1 && <span className="text-xs font-normal text-zinc-500">, {formatCompactUsd(totalLiquidity)} in all</span>}</Stat>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <thead>
            <tr className="text-zinc-500"><th className="py-1.5 text-left font-medium" /> {PERIODS.map((p) => <th key={p} className="py-1.5 text-right font-medium">{PERIOD_LABEL[p]}</th>)}</tr>
          </thead>
          <tbody className="num">
            <tr className="border-t border-white/[0.05]"><td className="py-1.5 text-zinc-400">Price change</td>{PERIODS.map((p) => <td key={p} className={`py-1.5 text-right ${pnlClass(pair.change[p])}`}>{formatPct(pair.change[p], 1)}</td>)}</tr>
            <tr className="border-t border-white/[0.05]"><td className="py-1.5 text-zinc-400">Volume</td>{PERIODS.map((p) => <td key={p} className="py-1.5 text-right text-zinc-200">{formatCompactUsd(pair.volume[p])}</td>)}</tr>
            <tr className="border-t border-white/[0.05]"><td className="py-1.5 text-zinc-400">Buys / sells</td>{PERIODS.map((p) => {
              const t = pair.txns[p];
              return <td key={p} className="py-1.5 text-right">{t ? <><span className="text-emerald-300">{formatNumber(t.buys, 0)}</span><span className="text-zinc-600"> / </span><span className="text-rose-300">{formatNumber(t.sells, 0)}</span></> : '—'}</td>;
            })}</tr>
          </tbody>
        </table>
      </div>

      <dl className="space-y-1.5 text-xs">
        {contract && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-zinc-500">Contract</dt>
            <dd className="flex items-center gap-1 text-zinc-200"><span className="num">{shortAddress(contract, 6, 6)}</span><CopyAddress value={contract} label={`Copy ${pair.base.symbol} contract address`} />
              <a href={tokenUrl(chain, contract)} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label="Open the contract in the explorer"><ArrowSquareOut className="h-3.5 w-3.5" /></a></dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <dt className="text-zinc-500">Top pool</dt>
          <dd className="flex items-center gap-1 text-zinc-200"><span className="num">{shortAddress(pair.pairAddress, 6, 6)}</span><CopyAddress value={pair.pairAddress} label="Copy pool address" />
            <a href={pair.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label="Open the pool on DexScreener"><ArrowSquareOut className="h-3.5 w-3.5" /></a></dd>
        </div>
      </dl>

      {pairs.length > 1 && (
        <div>
          <p className="eyebrow mb-1.5">Other pools</p>
          <ul className="space-y-1 text-xs">
            {pairs.slice(1, 6).map((p) => (
              <li key={p.pairAddress} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <span className="truncate text-zinc-300">{p.base.symbol} / {p.quote.symbol} <span className="text-zinc-500">on {p.dexId}</span></span>
                <span className="num shrink-0 text-zinc-400">liq {formatCompactUsd(p.liquidityUsd)}<a href={p.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-block align-middle text-zinc-500 hover:text-white" aria-label="Open this pool on DexScreener"><ArrowSquareOut className="h-3 w-3" /></a></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Details from DexScreener. Links are added by the token's team and are not checked by Arctos.</p>
    </div>
  );
}

// ------------------------------------------------------------------ panel

interface Props {
  token: Token | null;
  /** The two tokens of the swap, to switch which one is shown. */
  sides: Array<{ side: 'to' | 'from'; token: Token | null }>;
  activeSide: Token | null;
  onSide: (side: 'to' | 'from') => void;
  onPick: (chain: SwapChain, address: string) => void;
}

/** Search, chart, token details and DexScreener's own lists, beside the swap panel. */
export function MarketPanel({ token, sides, activeSide, onSide, onPick }: Props) {
  const [view, setView] = useState<View>('chart');
  const { chain, pairs, error, loading } = useTokenPairs(token);
  const pair = pairs[0] ?? null;
  const contract = token && chain && !isNative(chain, token.address) ? token.address : null;

  const tabs: Array<{ id: View; label: string; icon: ReactNode }> = [
    { id: 'chart', label: 'Chart', icon: <ChartLineUp className="h-3.5 w-3.5" aria-hidden /> },
    { id: 'info', label: 'Info', icon: <Info className="h-3.5 w-3.5" aria-hidden /> },
    { id: 'screener', label: 'DexScreener', icon: <Fire className="h-3.5 w-3.5" aria-hidden /> },
  ];

  return (
    <div className="space-y-3">
      <DexSearch onPick={(c, a) => { onPick(c, a); setView((v) => (v === 'screener' ? 'chart' : v)); }} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {view !== 'screener' && <TokenImage src={pair?.imageUrl ?? token?.logo ?? null} symbol={token?.symbol ?? '?'} size={28} />}
            <div className="min-w-0">
              {view === 'screener' ? (
                <p className="text-sm font-semibold text-white">DexScreener</p>
              ) : (
                <p className="flex items-center gap-1 truncate text-sm font-semibold text-white">
                  {token ? `${token.symbol}${pair ? ` / ${pair.quote.symbol}` : ''}` : 'Pick a token'}
                  {contract && <CopyAddress value={contract} label={`Copy ${token?.symbol} contract address`} />}
                  {chain && <span className="ml-1 text-xs font-normal text-zinc-500">{chain.name}{pair ? `, ${pair.dexId}` : ''}</span>}
                </p>
              )}
              {view !== 'screener' && pair && (
                <p className="num text-xs"><span className="font-semibold text-white">{formatPrice(pair.priceUsd)}</span> <span className={pnlClass(pair.change.h24)}>{formatPct(pair.change.h24)} 24h</span>
                  <span className="text-zinc-500"> liq </span><span className="text-zinc-300">{formatCompactUsd(pair.liquidityUsd)}</span>
                  <span className="text-zinc-500"> mcap </span><span className="text-zinc-300">{formatCompactUsd(pair.marketCap ?? pair.fdv)}</span></p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view !== 'screener' && (
              <div className="seg flex" role="tablist" aria-label="Token shown">
                {sides.map(({ side, token: t }) => (
                  <button key={side} type="button" role="tab" aria-selected={activeSide === t && Boolean(t)} disabled={!t} onClick={() => onSide(side)} className="seg-item px-2.5 py-1 text-xs font-medium">{t?.symbol ?? '—'}</button>
                ))}
              </div>
            )}
            <div className="seg flex" role="tablist" aria-label="Market view">
              {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={view === t.id} onClick={() => setView(t.id)} className="seg-item inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium">{t.icon}{t.label}</button>)}
            </div>
            {view !== 'screener' && pair && (
              <a href={pair.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label="Open on DexScreener"><ArrowSquareOut className="h-4 w-4" /></a>
            )}
          </div>
        </div>
        {view === 'chart' && <ChartView token={token} chain={chain} pair={pair} error={error} />}
        {view === 'info' && <InfoView token={token} chain={chain} pairs={pairs} error={error} loading={loading} />}
        {view === 'screener' && <DexScreenerEmbed initialSlug={chain?.dexscreener ?? 'solana'} />}
      </Card>
    </div>
  );
}
