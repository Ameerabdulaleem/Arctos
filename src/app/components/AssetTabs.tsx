import { useState } from 'react';
import { ArrowsLeftRight, Coins, Flask, ImageSquare, Info, Wallet } from '@phosphor-icons/react';
import type { Coin } from '../services/marketService';
import { portfolioService, type Holding, type Nft, type PortfolioResponse } from '../services/portfolioService';
import { usePolling } from '../hooks/usePolling';
import { chainByKey, isNative } from '../swap/chains';
import type { MarkedPosition } from '../lib/paperTrading';
import { formatDollarPrice, formatDollars, formatNumber, formatPct, formatPrice, formatUsd, pnlClass, sparklinePath } from '../lib/format';
import { Empty, ErrorNotice, Loading } from './ui/common';

type Tab = 'wallet' | 'nfts' | 'market' | 'paper';

interface Props {
  wallet: { connected: boolean; address?: string; data: PortfolioResponse | null; loading: boolean; error: string | null; onConnect: () => void; onRetry: () => void };
  coins: Coin[] | null;
  paperPositions: MarkedPosition[];
  onOpenTerminal: () => void;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Wallet }> = [
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'nfts', label: 'NFTs', icon: ImageSquare },
  { id: 'market', label: 'Market', icon: Coins },
  { id: 'paper', label: 'Paper positions', icon: Flask },
];

/** A token's logo, or its initials when there is none or it fails to load. */
function AssetLogo({ src, label }: { src?: string; label: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt="" width={36} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-9 w-9 shrink-0 rounded-full bg-white/5 object-cover" />;
  }
  return <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400/25 to-violet-400/25 text-[10px] font-bold text-white">{label.slice(0, 3).toUpperCase()}</span>;
}

/** Opens the swap panel with this holding as the token to sell. */
function sellHref(h: Holding): string | null {
  const chain = chainByKey(h.chain);
  if (!chain) return null;
  const token = h.address ?? (chain.vm === 'svm' ? chain.wrapped : '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  if (!h.address && !isNative(chain, token)) return null;
  return `#/trading?chain=${encodeURIComponent(chain.key)}&token=${encodeURIComponent(token)}&side=sell`;
}

function NftGrid({ address }: { address: string }) {
  const nfts = usePolling((s) => portfolioService.nfts(address, s), 300_000, [address]);
  if (nfts.loading && !nfts.data) return <Loading label="Looking up NFTs" />;
  if (nfts.error && !nfts.data) return <ErrorNotice message={nfts.error} onRetry={nfts.refresh} />;
  const data = nfts.data;
  if (!data) return null;
  if (!data.available) {
    return <Empty title="NFTs are not available for this wallet yet">Reading NFTs on EVM chains needs a wallet index, which is not switched on for this site yet. Solana wallets show their NFTs.</Empty>;
  }
  if (data.nfts.length === 0) return <Empty title="No NFTs found">This wallet holds no NFTs on the chains Arctos reads.</Empty>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {data.nfts.map((n: Nft) => (
        <li key={`${n.chain}:${n.contract}:${n.tokenId ?? ''}`} className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div className="aspect-square bg-white/[0.03]">
            {n.image ? <img src={n.image} alt={n.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-zinc-600"><ImageSquare className="h-8 w-8" aria-hidden /></div>}
          </div>
          <div className="p-2.5">
            <p className="truncate text-sm font-medium text-white" title={n.name}>{n.name}</p>
            <p className="truncate text-[11px] text-zinc-500">{n.collection ?? n.standard} <span className="text-zinc-600">on {n.chainName}</span></p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AssetTabs({ wallet, coins, paperPositions, onOpenTerminal }: Props) {
  const [tab, setTab] = useState<Tab>('wallet');

  return (
    <div className="panel p-5">
      <div role="tablist" aria-label="Assets" className="seg mb-5 max-w-full flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="seg-item"
          >
            <Icon className="w-4 h-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'wallet' && (
        !wallet.connected ? (
          <Empty title="No wallet connected">
            Connect a wallet to see its live balances on Solana, BNB Chain, Ethereum, Base, Arbitrum and more.
            <div className="mt-3"><button onClick={wallet.onConnect} className="btn btn-primary px-4 py-2">Connect wallet</button></div>
          </Empty>
        ) : wallet.loading && !wallet.data ? <Loading label="Reading balances from the chain" />
        : wallet.error && !wallet.data ? <ErrorNotice message={wallet.error} onRetry={wallet.onRetry} />
        : wallet.data && wallet.data.holdings.length === 0 ? <Empty title="No assets found">This wallet holds no tokens Arctos could read{wallet.data.complete === false ? ' among the native coins and major tokens it checks' : ''}.</Empty>
        : (
          <>
            <ul className="divide-y divide-white/[0.06]">
              {wallet.data?.holdings.map((h) => {
                const sell = sellHref(h);
                return (
                  <li key={`${h.chain}-${h.address ?? 'native'}-${h.symbol}`} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AssetLogo src={h.logo} label={h.symbol} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{h.name} <span className="chip ml-1 px-2 py-0.5">{h.chainName}</span></p>
                        <p className="num truncate text-sm text-zinc-500">{formatNumber(h.amount, 6)} {h.symbol}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="num font-semibold text-white">{h.valueUsd == null ? 'No price' : formatUsd(h.valueUsd)}</p>
                        {h.change24h != null && <p className={`num text-xs ${pnlClass(h.change24h)}`}>{formatPct(h.change24h)}</p>}
                      </div>
                      {sell && <a href={sell} className="btn btn-secondary btn-icon h-9 w-9" aria-label={`Swap ${h.symbol}`} title={`Swap ${h.symbol}`}><ArrowsLeftRight className="h-4 w-4" /></a>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {wallet.data && (Boolean(wallet.data.hiddenTokens) || wallet.data.partial || wallet.data.complete === false) && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-zinc-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {wallet.data.hiddenTokens ? `${wallet.data.hiddenTokens} small or unpriced ${wallet.data.hiddenTokens === 1 ? 'token is' : 'tokens are'} not shown, mostly airdropped spam. ` : ''}
                  {wallet.data.partial ? 'Some balances could not be read just now, so the total may be low. ' : ''}
                  {wallet.data.complete === false ? 'On EVM chains only native coins and major tokens are checked for now.' : ''}
                </span>
              </p>
            )}
          </>
        )
      )}

      {tab === 'nfts' && (
        !wallet.connected || !wallet.address ? (
          <Empty title="No wallet connected">Connect a wallet to see its NFTs.<div className="mt-3"><button onClick={wallet.onConnect} className="btn btn-primary px-4 py-2">Connect wallet</button></div></Empty>
        ) : <NftGrid address={wallet.address} />
      )}

      {tab === 'market' && (
        !coins ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-white/[0.07] text-left">
                  <th className="py-2 pr-4 font-medium">Coin</th><th className="py-2 pr-4 font-medium text-right">Price</th>
                  <th className="py-2 pr-4 font-medium text-right">24h</th><th className="py-2 pr-4 font-medium text-right hidden sm:table-cell">7d</th>
                  <th className="py-2 font-medium text-right hidden md:table-cell">Last 7 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {coins.slice(0, 15).map((c) => (
                  <tr key={c.id} className="transition hover:bg-white/[0.03]">
                    <td className="py-2.5 pr-4"><span className="text-white font-medium">{c.symbol}</span> <span className="text-zinc-500">{c.name}</span></td>
                    <td className="py-2.5 pr-4 text-right num text-white">{formatPrice(c.price)}</td>
                    <td className={`py-2.5 pr-4 text-right num ${pnlClass(c.change24h)}`}>{formatPct(c.change24h)}</td>
                    <td className={`py-2.5 pr-4 text-right num hidden sm:table-cell ${pnlClass(c.change7d)}`}>{formatPct(c.change7d)}</td>
                    <td className="py-2.5 hidden md:table-cell">
                      <svg viewBox="0 0 170 36" className="w-28 h-7 ml-auto" aria-hidden>
                        <path d={sparklinePath(c.sparkline7d)} fill="none" stroke={(c.change7d ?? 0) >= 0 ? '#34d399' : '#fb7185'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'paper' && (
        paperPositions.length === 0 ? (
          <Empty title="No open paper positions">
            Practice a trade in the terminal. Orders fill against the live order book with no real funds.
            <div className="mt-3"><button onClick={onOpenTerminal} className="btn btn-primary px-4 py-2">Open terminal</button></div>
          </Empty>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {paperPositions.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-white font-medium">{p.label}</p>
                  <p className="text-zinc-500 text-sm num">{formatNumber(p.qty, 6)} {p.symbol} at {formatDollarPrice(p.avgPrice)}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold num">{formatDollars(p.value)}</p>
                  <p className={`text-xs num ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPnl == null ? 'Waiting for price' : `${formatDollars(p.unrealizedPnl)} (${formatPct(p.unrealizedPct)})`}</p>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
