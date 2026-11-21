import { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, ArrowsLeftRight, Info, Wallet } from '@phosphor-icons/react';
import { errorMessage, isAbort } from '../../services/api';
import { portfolioService, type PortfolioResponse } from '../../services/portfolioService';
import { swapHref } from '../../lib/tokenLinks';
import { formatNumber, formatPct, formatUsd, pnlClass, shortAddress, timeAgo } from '../../lib/format';
import { Card, IconTile, Loading } from '../ui/common';
import { CopyAddress } from '../ui/CopyAddress';
import { TokenLinks } from '../ui/TokenLinks';
import { TokenLogo } from '../ui/TokenLogo';

/** An EVM wallet's holdings on every network, with the real balance and value of each token. */
export function EvmWalletHoldings({ address }: { address: string }) {
  const [state, setState] = useState<{ data: PortfolioResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const c = new AbortController();
    portfolioService.get(address, c.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => { if (!isAbort(e)) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false })); });
    return () => c.abort();
  }, [address, tick]);

  const byChain = useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    for (const h of state.data?.holdings ?? []) {
      const e = m.get(h.chain) ?? { name: h.chainName, total: 0, count: 0 };
      e.total += h.valueUsd ?? 0;
      e.count += 1;
      m.set(h.chain, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [state.data]);

  const d = state.data;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Wallet /></IconTile>EVM wallet holdings</h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">EVM <span className="num">{shortAddress(address, 5, 5)}</span><CopyAddress value={address} label="Copy the wallet address" />{d && <span>{`, updated ${timeAgo(d.updatedAt)}`}</span>}</p>
        </div>
        <button type="button" disabled={state.loading} onClick={() => { setState((s) => ({ ...s, loading: true })); setTick((t) => t + 1); }} className="btn btn-secondary btn-sm"><ArrowClockwise className="h-4 w-4" aria-hidden />Refresh</button>
      </div>

      {state.loading && !d ? <Loading label="Reading the wallet on every network" /> : state.error && !d ? <p role="alert" className="text-sm text-rose-300">{state.error}</p> : d && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="panel-inset p-3"><p className="eyebrow text-[10px]">Wallet value</p><p className="num text-lg font-semibold text-white">{formatUsd(d.totalUsd)}</p><p className="text-[11px] text-zinc-500">{d.holdings.length} holdings</p></div>
            {byChain.slice(0, 3).map(([k, c]) => (
              <div key={k} className="panel-inset p-3"><p className="eyebrow text-[10px]">{c.name}</p><p className="num text-lg font-semibold text-white">{formatUsd(c.total)}</p><p className="text-[11px] text-zinc-500">{c.count} {c.count === 1 ? 'holding' : 'holdings'}</p></div>
            ))}
          </div>

          {d.complete === false && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Only native coins and major tokens (stablecoins, wrapped ETH, BNB and BTC) are checked right now, so other tokens are missing. Every token on every network shows once the site owner adds a free Alchemy key (ALCHEMY_API_KEY) on the server.
            </p>
          )}

          {d.holdings.length === 0 ? (
            <p className="text-sm text-zinc-500">No holdings found on the networks checked.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Token</th>
                    <th className="py-2 pr-3 font-medium">Network</th>
                    <th className="py-2 pr-3 text-right font-medium">Balance</th>
                    <th className="py-2 pr-3 text-right font-medium">Value</th>
                    <th className="py-2 pr-3 text-right font-medium">24h</th>
                    <th className="py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {d.holdings.map((h) => {
                    const swap = h.address ? swapHref(h.chain, h.address) : null;
                    return (
                      <tr key={`${h.chain}:${h.address ?? h.symbol}`}>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <TokenLogo src={h.logo} symbol={h.symbol} size={22} />
                            <span className="font-medium text-white">{h.symbol}</span>
                            {h.address && <TokenLinks chain={h.chain} address={h.address} symbol={h.symbol} />}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-zinc-400">{h.chainName}</td>
                        <td className="num py-2 pr-3 text-right text-zinc-300">{formatNumber(h.amount, 6)}</td>
                        <td className="num py-2 pr-3 text-right text-zinc-200">{h.valueUsd == null ? 'No price' : formatUsd(h.valueUsd)}</td>
                        <td className={`num py-2 pr-3 text-right ${pnlClass(h.change24h)}`}>{h.change24h == null ? '—' : formatPct(h.change24h, 1)}</td>
                        <td className="py-2 text-right">{swap && <a href={swap} className="btn btn-secondary btn-sm" aria-label={`Swap ${h.symbol}`}><ArrowsLeftRight className="h-3.5 w-3.5" aria-hidden />Swap</a>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Balances are read live from each network. Profit and loss from a wallet's own trade history is worked out for Solana wallets for now; for EVM wallets the Trade Book shows what is held and its value today.
            {d.hiddenTokens ? ` ${d.hiddenTokens} small or unpriced tokens are counted but not listed.` : ''}
          </p>
        </>
      )}
    </Card>
  );
}
