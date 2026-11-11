import { useState } from 'react';
import { Coins, FlaskConical, Wallet } from 'lucide-react';
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
  { id: 'paper', label: 'Paper positions', icon: FlaskConical },
];

export function AssetTabs({ wallet, coins, paperPositions, onOpenTerminal }: Props) {
  const [tab, setTab] = useState<Tab>('wallet');

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
      <div role="tablist" aria-label="Assets" className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${tab === id ? 'bg-zinc-800 border-zinc-700 text-white' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'}`}
          >
            <Icon className="w-4 h-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'wallet' && (
        !wallet.connected ? (
          <Empty title="No wallet connected">
            Connect a wallet to see its live balances on Ethereum, BNB Chain, Base, Arbitrum or Solana.
            <div className="mt-3"><button onClick={wallet.onConnect} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">Connect wallet</button></div>
          </Empty>
        ) : wallet.loading && !wallet.data ? <Loading label="Reading balances from the chain" />
        : wallet.error && !wallet.data ? <ErrorNotice message={wallet.error} onRetry={wallet.onRetry} />
        : wallet.data && wallet.data.holdings.length === 0 ? <Empty title="No supported assets found">This address holds none of the native coins or major tokens Arctos reads. DeFi positions and NFTs are not included yet.</Empty>
        : (
          <ul className="divide-y divide-zinc-800/60">
            {wallet.data?.holdings.map((h) => (
              <li key={`${h.chain}-${h.symbol}`} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-white font-medium">{h.name} <span className="text-[11px] ml-1 bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{h.chainName}</span></p>
                  <p className="text-zinc-500 text-sm tabular-nums">{formatNumber(h.amount, 6)} {h.symbol}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold tabular-nums">{h.valueUsd == null ? 'No price' : formatUsd(h.valueUsd)}</p>
                  <p className={`text-xs tabular-nums ${pnlClass(h.change24h)}`}>{formatPct(h.change24h)}</p>
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
                <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-4 font-medium">Coin</th><th className="py-2 pr-4 font-medium text-right">Price</th>
                  <th className="py-2 pr-4 font-medium text-right">24h</th><th className="py-2 pr-4 font-medium text-right hidden sm:table-cell">7d</th>
                  <th className="py-2 font-medium text-right hidden md:table-cell">Last 7 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {coins.slice(0, 15).map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 pr-4"><span className="text-white font-medium">{c.symbol}</span> <span className="text-zinc-500">{c.name}</span></td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-white">{formatPrice(c.price)}</td>
                    <td className={`py-2.5 pr-4 text-right tabular-nums ${pnlClass(c.change24h)}`}>{formatPct(c.change24h)}</td>
                    <td className={`py-2.5 pr-4 text-right tabular-nums hidden sm:table-cell ${pnlClass(c.change7d)}`}>{formatPct(c.change7d)}</td>
                    <td className="py-2.5 hidden md:table-cell">
                      <svg viewBox="0 0 170 36" className="w-28 h-7 ml-auto" aria-hidden>
                        <path d={sparklinePath(c.sparkline7d)} fill="none" stroke={(c.change7d ?? 0) >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="2" />
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
            <div className="mt-3"><button onClick={onOpenTerminal} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">Open terminal</button></div>
          </Empty>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {paperPositions.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-white font-medium">{p.label}</p>
                  <p className="text-zinc-500 text-sm tabular-nums">{formatNumber(p.qty, 6)} {p.symbol} at {formatPrice(p.avgPrice)}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold tabular-nums">{formatUsd(p.value)}</p>
                  <p className={`text-xs tabular-nums ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPnl == null ? 'Waiting for price' : `${formatUsd(p.unrealizedPnl)} (${formatPct(p.unrealizedPct)})`}</p>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
