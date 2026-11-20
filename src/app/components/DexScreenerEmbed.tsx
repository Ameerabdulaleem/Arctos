import { useState } from 'react';
import { CHAINS } from '../swap/chains';

const SCREENER_CHAINS = [{ key: 'all', name: 'All chains', slug: '' }, ...CHAINS.map((c) => ({ key: c.key, name: c.name, slug: c.dexscreener }))];
const RANKS = [
  { id: 'trendingScoreH6', label: 'Trending' },
  { id: 'volume', label: 'Top volume' },
  { id: 'priceChangeH24', label: 'Gainers' },
  { id: 'pairAge', label: 'New pairs' },
] as const;

/**
 * DexScreener's own token lists (trending, top volume, gainers, new pairs and metas), embedded
 * as DexScreener serves them. The frame loads only while it is on screen.
 */
export function DexScreenerEmbed({ initialSlug, hint = 'To trade a token you find here, search for it by name or paste its contract address.' }: { initialSlug: string; hint?: string }) {
  const [slug, setSlug] = useState(SCREENER_CHAINS.some((c) => c.slug === initialSlug) ? initialSlug : '');
  const [rank, setRank] = useState<(typeof RANKS)[number]['id']>('trendingScoreH6');
  const order = rank === 'pairAge' ? 'asc' : 'desc';
  const src = `https://dexscreener.com/${slug ? encodeURIComponent(slug) : ''}?rankBy=${rank}&order=${order}&embed=1&theme=dark`;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="DexScreener chain">
          {SCREENER_CHAINS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={slug === c.slug} onClick={() => setSlug(c.slug)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${slug === c.slug ? 'border-blue-300/50 bg-blue-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25'}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="seg ml-auto flex" role="tablist" aria-label="DexScreener ranking">
          {RANKS.map((r) => <button key={r.id} type="button" role="tab" aria-selected={rank === r.id} onClick={() => setRank(r.id)} className="seg-item px-2.5 py-1 text-xs font-medium">{r.label}</button>)}
        </div>
      </div>
      <div className="relative h-[560px] bg-black/30 xl:h-[640px]">
        <iframe key={src} src={src} title="DexScreener token lists" className="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" loading="lazy" />
      </div>
      <p className="px-3 py-2 text-[11px] text-zinc-500">DexScreener's own lists. {hint}</p>
    </div>
  );
}
