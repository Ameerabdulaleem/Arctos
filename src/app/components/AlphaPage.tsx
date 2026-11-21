import { useMemo, useState, type ReactNode } from 'react';
import { ArrowSquareOut, ArrowsLeftRight, ChatCircle, Eye, Heart, Megaphone, Repeat, Rocket, Trophy, X as XIcon } from '@phosphor-icons/react';
import { usePolling } from '../hooks/usePolling';
import { alphaService, type AlphaCoin, type AlphaPost, type LaunchedCoin } from '../services/alphaService';
import type { SniperToken } from '../services/sniperService';
import { chainByKey } from '../swap/chains';
import { swapHref } from '../lib/tokenLinks';
import { formatCompactUsd, formatNumber, formatPct, formatPrice, pnlClass, safeHref, timeAgo } from '../lib/format';
import { Card, Empty, ErrorNotice, IconTile, Loading, PageHeader, Pill } from './ui/common';
import { TokenLinks } from './ui/TokenLinks';
import { Avatar, TokenLogo } from './ui/TokenLogo';

function CoinLogo({ token, size = 32 }: { token: SniperToken; size?: number }) {
  return <TokenLogo src={token.imageUrl} symbol={token.symbol} size={size} />;
}

/** Post text with $tickers and contract addresses picked out. Rendered as text, never as HTML. */
function PostText({ text }: { text: string }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9_]{1,14}\b|\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className={p.startsWith('$') ? 'font-semibold text-blue-300' : 'num rounded bg-white/[0.06] px-1 text-[12px] text-amber-200'}>{p}</span> : <span key={i}>{p}</span>))}
    </p>
  );
}

function Stat({ k, children }: { k: string; children: ReactNode }) {
  return <span className="text-zinc-500">{k} <span className="num text-zinc-200">{children}</span></span>;
}

function CoinRow({ coin, rank, selected, onSelect, extra }: {
  coin: SniperToken; rank: number; selected: boolean; onSelect: () => void; extra: ReactNode;
}) {
  const swap = swapHref(coin.chain, coin.address);
  return (
    <li className={`rounded-xl border p-3 transition ${selected ? 'border-blue-300/50 bg-blue-400/[0.07]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15'}`}>
      <div className="flex items-start gap-3">
        <span className="num w-6 shrink-0 pt-1.5 text-center text-xs font-semibold text-zinc-500">{rank}</span>
        <CoinLogo token={coin} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onSelect} className="flex max-w-full items-center gap-1.5 text-left" title="Show the posts about it">
            <span className="shrink-0 font-semibold text-white">{coin.symbol}</span>
            <span className="min-w-0 truncate text-xs text-zinc-500">{coin.name}</span>
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-white/[0.06] px-1.5 py-px text-zinc-400">{chainByKey(coin.chain)?.name ?? coin.chain}</span>
            <span className="num text-zinc-500">{coin.address.slice(0, 4)}…{coin.address.slice(-4)}</span>
            <TokenLinks chain={coin.chain} address={coin.address} symbol={coin.symbol} pairUrl={coin.url} />
          </div>
          {extra}
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            <Stat k="Price">{formatPrice(coin.priceUsd)}</Stat>
            <Stat k="Mcap">{formatCompactUsd(coin.marketCapUsd)}</Stat>
            <Stat k="Liq">{formatCompactUsd(coin.liquidityUsd)}</Stat>
            {coin.change24h != null && <span className={`num ${pnlClass(coin.change24h)}`}>{formatPct(coin.change24h, 1)} 24h</span>}
            {coin.createdAt && <span className="text-zinc-500">pool {timeAgo(coin.createdAt)}</span>}
          </p>
        </div>
        {swap && <a href={swap} className="btn btn-secondary btn-sm shrink-0" aria-label={`Swap for ${coin.symbol}`}><ArrowsLeftRight className="h-3.5 w-3.5" aria-hidden />Swap</a>}
      </div>
    </li>
  );
}

function PostCard({ post, coins, onCoin }: { post: AlphaPost; coins: Map<string, SniperToken>; onCoin: (id: string) => void }) {
  const href = safeHref(post.url);
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <header className="mb-2 flex items-start gap-3">
        <Avatar src={post.author.avatar} handle={post.author.handle} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{post.author.name}{post.author.verified && <span className="ml-1 text-blue-300" aria-label="Verified">✓</span>}</p>
          <p className="truncate text-xs text-zinc-500">@{post.author.handle}{post.author.followers ? `, ${formatNumber(post.author.followers, 0)} followers` : ''} · {timeAgo(post.createdAt)}{post.isRetweet ? ' · repost' : post.isReply ? ' · reply' : ''}</p>
        </div>
        {href && <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm shrink-0" aria-label="View the post on X"><XIcon className="h-3.5 w-3.5" aria-hidden />View</a>}
      </header>
      <PostText text={post.text} />
      {post.quoted && <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/20 p-2.5 text-xs text-zinc-400"><PostText text={post.quoted} /></div>}
      {post.coins.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {post.coins.map((id) => {
            const c = coins.get(id);
            return c ? <button key={id} type="button" onClick={() => onCoin(id)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300/30 bg-blue-400/10 px-2 py-1 text-xs font-semibold text-blue-100 hover:border-blue-300/60"><CoinLogo token={c} size={16} />{c.symbol}</button> : null;
          })}
        </div>
      )}
      <footer className="mt-2.5 flex gap-4 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1"><ChatCircle className="h-3.5 w-3.5" aria-hidden />{formatNumber(post.replies, 0)}</span>
        <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" aria-hidden />{formatNumber(post.retweets, 0)}</span>
        <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" aria-hidden />{formatNumber(post.likes, 0)}</span>
        <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden />{formatNumber(post.views, 0)}</span>
      </footer>
    </article>
  );
}

function SetupCard({ accounts }: { accounts: string[] }) {
  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-lg font-semibold text-white">Connect an X data source to turn Alpha on</h2>
      <p className="text-sm text-zinc-400">X does not let apps read posts for free, so Alpha needs a key from a data provider. The service keeps it on the server; it never reaches the browser.</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
        <li>Sign up at twitterapi.io (new accounts get up to $1 of free credits). Posts cost about $0.15 per 1,000, so following {accounts.length} accounts costs roughly $0.10 to $0.20 a day.</li>
        <li>Copy your API key from its dashboard.</li>
        <li>In Vercel, open the project's Settings, Environment Variables, and add <code className="rounded bg-white/[0.06] px-1">TWITTERAPI_IO_KEY</code> with that key. Then redeploy.</li>
      </ol>
      <p className="text-xs text-zinc-500">An official X API key works too: set <code className="rounded bg-white/[0.06] px-1">X_BEARER_TOKEN</code> instead. It costs about $5 per 1,000 posts. To change who is followed, set <code className="rounded bg-white/[0.06] px-1">ALPHA_ACCOUNTS</code> to a comma separated list of handles.</p>
      <p className="text-xs text-zinc-500">Accounts followed now: {accounts.map((a) => `@${a}`).join(', ')}.</p>
    </Card>
  );
}

/** What top traders and founders post on X, and the coins in those posts, ranked by how many of them called each. */
export function AlphaPage() {
  const alpha = usePolling((s) => alphaService.get(s), 45_000);
  const [tab, setTab] = useState<'called' | 'launched'>('called');
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const data = alpha.data;

  const coinMap = useMemo(() => {
    const m = new Map<string, SniperToken>();
    for (const c of [...(data?.coins ?? []), ...(data?.launched ?? [])]) m.set(c.id, c);
    return m;
  }, [data]);
  const avatars = useMemo(() => new Map((data?.posts ?? []).map((p) => [p.author.handle, p.author.avatar])), [data]);
  const handles = useMemo(() => [...new Set((data?.posts ?? []).map((p) => p.author.handle))], [data]);

  const posts = (data?.posts ?? []).filter((p) => !hidden.has(p.author.handle) && (!selected || p.coins.includes(selected) || data?.launched.some((l) => l.id === selected && l.postId === p.id)));
  const selectedCoin = selected ? coinMap.get(selected) : undefined;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <PageHeader icon={<Megaphone />} tone="amber" title="Alpha" subtitle="What top traders and founders post on X, and the coins they call, ranked by how many of them called each." badge={data?.configured ? <Pill tone="green">Live</Pill> : undefined} />

      {alpha.loading && !data ? <Loading label="Reading posts" />
        : alpha.error && !data ? <ErrorNotice message={alpha.error} onRetry={alpha.refresh} />
        : data && !data.configured ? <SetupCard accounts={data.accounts} />
        : data && (
          <>
            {data.error && <p role="status" className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-2.5 text-xs text-amber-200">{data.error}</p>}
            {handles.length > 0 && (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Accounts">
                {handles.map((h) => (
                  <button key={h} type="button" aria-pressed={!hidden.has(h)} onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; })}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition ${hidden.has(h) ? 'border-white/[0.06] text-zinc-600 opacity-60' : 'border-white/15 bg-white/[0.04] text-zinc-200'}`}>
                    <Avatar src={avatars.get(h)} handle={h} size={20} />@{h}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <Card className="order-2 p-5 lg:order-1">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="ice" size="sm"><XIcon /></IconTile>Posts{selectedCoin ? ` about ${selectedCoin.symbol}` : ''}</h2>
                  {selected && <button type="button" onClick={() => setSelected(null)} className="btn btn-ghost btn-sm">Show every post</button>}
                </div>
                {posts.length === 0 ? <Empty title="No posts yet">New posts from the accounts above appear here within about a minute of being posted.</Empty> : (
                  <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} coins={coinMap} onCoin={setSelected} />)}</div>
                )}
              </Card>

              <Card className="order-1 h-fit p-5 lg:order-2 lg:sticky lg:top-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="amber" size="sm"><Trophy /></IconTile>Coins</h2>
                  <div className="seg flex" role="tablist" aria-label="Coin lists">
                    <button type="button" role="tab" aria-selected={tab === 'called'} onClick={() => setTab('called')} className="seg-item px-2.5 py-1 text-xs">Most called ({data.coins.length})</button>
                    <button type="button" role="tab" aria-selected={tab === 'launched'} onClick={() => setTab('launched')} className="seg-item inline-flex items-center gap-1 px-2.5 py-1 text-xs"><Rocket className="h-3.5 w-3.5" aria-hidden />Launched after a post ({data.launched.length})</button>
                  </div>
                </div>
                {tab === 'called' ? (
                  data.coins.length === 0 ? <Empty title="No coins called yet">Coins appear when a post gives a contract, a launch or chart link, or a $ticker.</Empty> : (
                    <ol className="max-h-[75vh] space-y-2 overflow-y-auto pr-1">
                      {data.coins.map((c: AlphaCoin, i) => (
                        <CoinRow key={c.id} coin={c} rank={i + 1} selected={selected === c.id} onSelect={() => setSelected(c.id)} extra={
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="flex -space-x-1">{c.kols.slice(0, 5).map((k) => <span key={k} className="rounded-full ring-2 ring-[#0b1018]"><Avatar src={avatars.get(k)} handle={k} size={18} /></span>)}</span>
                            <span className="font-semibold text-emerald-300">{c.kols.length} {c.kols.length === 1 ? 'account' : 'accounts'}</span>
                            <span className="text-zinc-500">{c.kols.slice(0, 3).map((k) => `@${k}`).join(', ')}{c.kols.length > 3 ? ` +${c.kols.length - 3}` : ''}</span>
                            <span className="text-zinc-500">first called {timeAgo(c.firstSeen)}</span>
                            <Pill tone={c.evidence === 'contract' ? 'green' : 'amber'}>{c.evidence === 'contract' ? 'Contract posted' : 'Ticker match'}</Pill>
                          </div>
                        } />
                      ))}
                    </ol>
                  )
                ) : (
                  data.launched.length === 0 ? <Empty title="Nothing launched after a post yet">When a post names something new (a pet, a word, a #tag) and a coin with that name appears on DexScreener after it, it shows up here.</Empty> : (
                    <ol className="max-h-[75vh] space-y-2 overflow-y-auto pr-1">
                      {data.launched.map((c: LaunchedCoin, i) => (
                        <CoinRow key={c.id} coin={c} rank={i + 1} selected={selected === c.id} onSelect={() => setSelected(c.id)} extra={
                          <p className="mt-1.5 text-[11px] text-amber-200">Named after “{c.word}”, launched {c.minutesAfter} min after @{c.kol} posted it. Many coins copy a famous post; check it before buying.</p>
                        } />
                      ))}
                    </ol>
                  )
                )}
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500"><ArrowSquareOut className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />A $ticker is matched to its most liquid, longest running token, so copycats are skipped; a posted contract is used exactly. Being called is not a reason to buy: check the contract and liquidity first.</p>
              </Card>
            </div>
          </>
        )}
    </div>
  );
}
