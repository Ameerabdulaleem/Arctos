import { useState } from 'react';
import { Coins, Flask, Wallet } from '@phosphor-icons/react';
import type { Coin } from '../services/marketService';
import type { PortfolioResponse } from '../services/portfolioService';
import type { MarkedPosition } from '../lib/paperTrading';
import { formatNumber, formatPct, formatPrice, formatUsd, pnlClass, sparklinePath } from '../lib/format';
import { Empty, ErrorNotice, Loading } from './ui/common';

type Tab = 'wallet' | 'market' | 'paper';

interface Props {
  wallet: { connected: boolean; data: PortfolioResponse | null; loading: boolean; error: string | null; onConnect: () => void; onRetry: () => void };
  coins: Coin[] | null;
  paperPositions: MarkedPosition[];
  onOpenTerminal: () => void;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Wallet }> = [
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'market', label: 'Market', icon: Coins },
  { id: 'paper', label: 'Paper positions', icon: Flask },
];

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
            Connect a wallet to see its live balances on Ethereum, BNB Chain, Base, Arbitrum or Solana.
            <div className="mt-3"><button onClick={wallet.onConnect} className="btn btn-primary px-4 py-2">Connect wallet</button></div>
          </Empty>
        ) : wallet.loading && !wallet.data ? <Loading label="Reading balances from the chain" />
        : wallet.error && !wallet.data ? <ErrorNotice message={wallet.error} onRetry={wallet.onRetry} />
        : wallet.data && wallet.data.holdings.length === 0 ? <Empty title="No supported assets found">This address holds none of the native coins or major tokens Arctos reads. DeFi positions and NFTs are not included yet.</Empty>
        : (
          <ul className="divide-y divide-white/[0.06]">
            {wallet.data?.holdings.map((h) => (
              <li key={`${h.chain}-${h.symbol}`} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-white font-medium">{h.name} <span className="chip ml-1 px-2 py-0.5">{h.chainName}</span></p>
                  <p className="text-zinc-500 text-sm num">{formatNumber(h.amount, 6)} {h.symbol}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold num">{h.valueUsd == null ? 'No price' : formatUsd(h.valueUsd)}</p>
                  <p className={`text-xs num ${pnlClass(h.change24h)}`}>{formatPct(h.change24h)}</p>
                </div>
              </li>
            ))}
          </ul>
        )
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
                  <p className="text-zinc-500 text-sm num">{formatNumber(p.qty, 6)} {p.symbol} at {formatPrice(p.avgPrice)}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold num">{formatUsd(p.value)}</p>
                  <p className={`text-xs num ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPnl == null ? 'Waiting for price' : `${formatUsd(p.unrealizedPnl)} (${formatPct(p.unrealizedPct)})`}</p>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
