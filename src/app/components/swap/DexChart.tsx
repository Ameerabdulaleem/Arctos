import { useEffect, useState } from 'react';
import { ArrowSquareOut, ChartLineUp } from '@phosphor-icons/react';
import { chainById, isNative } from '../../swap/chains';
import type { Token } from '../../swap/types';
import { formatCompactUsd, formatPct, formatPrice, pnlClass } from '../../lib/format';
import { Card, IconTile } from '../ui/common';

interface Pair {
  pairAddress: string;
  dexId: string;
  url: string;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  fdv: number | null;
  base: string;
  quote: string;
}

const PAIR = /^[A-Za-z0-9]{20,66}$/;

function readPairs(body: unknown): Pair[] {
  if (!Array.isArray(body)) return [];
  const out: Pair[] = [];
  for (const raw of body) {
    const p = raw as Record<string, unknown>;
    if (typeof p.pairAddress !== 'string' || !PAIR.test(p.pairAddress)) continue;
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    out.push({
      pairAddress: p.pairAddress,
      dexId: typeof p.dexId === 'string' ? p.dexId : 'dex',
      url: typeof p.url === 'string' && p.url.startsWith('https://dexscreener.com/') ? p.url : `https://dexscreener.com/`,
      priceUsd: num(p.priceUsd),
      change24h: num((p.priceChange as Record<string, unknown> | undefined)?.h24),
      liquidityUsd: num((p.liquidity as Record<string, unknown> | undefined)?.usd),
      volume24h: num((p.volume as Record<string, unknown> | undefined)?.h24),
      fdv: num(p.fdv),
      base: String((p.baseToken as Record<string, unknown> | undefined)?.symbol ?? ''),
      quote: String((p.quoteToken as Record<string, unknown> | undefined)?.symbol ?? ''),
    });
  }
  return out.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

/** DexScreener's live chart of a token's deepest pool, where the order book chart used to be. */
export function DexChart({ token }: { token: Token | null }) {
  const chain = token ? chainById(token.chainId) : undefined;
  const address = token && chain ? (isNative(chain, token.address) ? chain.wrapped : token.address) : null;
  const [state, setState] = useState<{ key: string; pair: Pair | null; error: string | null } | null>(null);
  const key = chain && address ? `${chain.dexscreener}:${address}` : '';

  useEffect(() => {
    if (!chain || !address) return;
    const ctrl = new AbortController();
    fetch(`https://api.dexscreener.com/tokens/v1/${chain.dexscreener}/${encodeURIComponent(address)}`, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`DexScreener answered ${r.status}`))))
      .then((body) => {
        const pairs = readPairs(body);
        setState({ key, pair: pairs[0] ?? null, error: pairs.length ? null : 'DexScreener has no pool for this token yet.' });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ key, pair: null, error: e instanceof Error ? e.message : 'DexScreener could not be reached.' });
      });
    return () => ctrl.abort();
  }, [key, chain, address]);

  const current = state?.key === key ? state : null;
  const pair = current?.pair ?? null;
  const src = pair && chain
    ? `https://dexscreener.com/${chain.dexscreener}/${pair.pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`
    : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconTile tone="mint" size="sm"><ChartLineUp /></IconTile>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {token ? `${token.symbol}${pair ? ` / ${pair.quote}` : ''}` : 'Pick a token'}
              {chain && <span className="ml-2 text-xs font-normal text-zinc-500">{chain.name}{pair ? `, ${pair.dexId}` : ''}</span>}
            </p>
          </div>
        </div>
        {pair && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {pair.priceUsd != null && <span className="num font-semibold text-white">{formatPrice(pair.priceUsd)}</span>}
            {pair.change24h != null && <span className={`num ${pnlClass(pair.change24h)}`}>{formatPct(pair.change24h)} 24h</span>}
            {pair.liquidityUsd != null && <span className="text-zinc-400">Liquidity <span className="num text-zinc-200">{formatCompactUsd(pair.liquidityUsd)}</span></span>}
            {pair.volume24h != null && <span className="text-zinc-400">Volume <span className="num text-zinc-200">{formatCompactUsd(pair.volume24h)}</span></span>}
            {pair.fdv != null && <span className="text-zinc-400">FDV <span className="num text-zinc-200">{formatCompactUsd(pair.fdv)}</span></span>}
            <a href={pair.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200">
              DexScreener <ArrowSquareOut className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        )}
      </div>
      <div className="relative h-[420px] bg-black/30 sm:h-[520px] xl:h-[600px]">
        {src ? (
          <iframe
            key={src}
            src={src}
            title={`${token?.symbol ?? 'Token'} chart on DexScreener`}
            className="absolute inset-0 h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
            {!token ? 'Choose the token you want to receive and its live chart appears here.' : current?.error ?? 'Finding the deepest pool on DexScreener…'}
          </div>
        )}
      </div>
    </Card>
  );
}
