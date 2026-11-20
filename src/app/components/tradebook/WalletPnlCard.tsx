import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, CircleNotch, ClockCounterClockwise, Wallet } from '@phosphor-icons/react';
import { useConnectedWallets } from '../../hooks/useConnectedWallets';
import { formatNumber, formatPct, formatPrice, formatUsd, pnlClass, shortAddress, timeAgo } from '../../lib/format';
import { solPriceLookup } from '../../lib/solPriceHistory';
import { computePnl, STABLE_MINTS, type WalletPnl } from '../../lib/walletPnl';
import { portfolioService } from '../../services/portfolioService';
import { tokenPairs, usdPriceOf } from '../../swap/dexscreener';
import { loadWalletHistory, type WalletTx } from '../../swap/solanaHistory';
import { Card, IconTile } from '../ui/common';
import { CopyAddress } from '../ui/CopyAddress';

interface Names {
  [mint: string]: { symbol: string; name: string };
}

/** Names for mints the portfolio did not list, from Jupiter's token list. */
async function namesFor(mints: string[]): Promise<Names> {
  const out: Names = {};
  for (let i = 0; i < mints.length; i += 100) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 100).join(',')}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const list = res.ok ? ((await res.json()) as Array<{ id?: string; symbol?: string; name?: string }>) : [];
      for (const t of Array.isArray(list) ? list : []) if (t.id && t.symbol) out[t.id] = { symbol: String(t.symbol).slice(0, 16), name: String(t.name ?? '').slice(0, 40) };
    } catch {
      /* names are a nicety */
    }
  }
  return out;
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="panel-inset p-3">
      <p className="eyebrow text-[10px]">{label}</p>
      <p className={`num text-lg font-semibold ${tone ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

/** Profit and loss of the connected Solana wallet, worked out from its own trades on chain. */
export function WalletPnlCard() {
  const { wallets } = useConnectedWallets();
  const solana = wallets.find((w) => w.kind === 'solana') ?? null;
  const evm = wallets.find((w) => w.kind === 'evm') ?? null;
  const [txs, setTxs] = useState<WalletTx[] | null>(null);
  const [state, setState] = useState<{ pnl: WalletPnl; names: Names; scanned: number; oldest: string | null; complete: boolean; at: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const address = solana?.address ?? null;

  const run = useCallback(async (older = false) => {
    if (!address) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const history = await loadWalletHistory(address, { limit: 500, before: older ? state?.oldest ?? undefined : undefined, signal: c.signal, onProgress: (done, total) => setProgress({ done, total }) });
      const all = new Map<string, WalletTx>();
      for (const t of [...(older ? txs ?? [] : []), ...history.txs]) all.set(t.sig, t);
      const merged = [...all.values()].sort((a, b) => a.time - b.time);
      const [solAt, portfolio] = await Promise.all([
        solPriceLookup(merged.filter((t) => t.sol !== '0').map((t) => t.time)),
        portfolioService.get(address, c.signal).catch(() => null),
      ]);
      const prices = new Map<string, number>();
      const holdings = new Map<string, number>();
      const names: Names = {};
      for (const h of portfolio?.holdings ?? []) {
        if (!h.address) continue;
        if (h.priceUsd != null) prices.set(h.address, h.priceUsd);
        holdings.set(h.address, h.amount);
        names[h.address] = { symbol: h.symbol, name: h.name };
      }
      let pnl = computePnl(merged, solAt, prices, portfolio ? holdings : undefined);
      // Prices for tokens still held that the portfolio did not price.
      const missing = pnl.tokens.filter((t) => t.heldQty > 0 && t.priceUsd == null).slice(0, 12);
      if (missing.length) {
        await Promise.all(missing.map(async (t) => {
          const p = await tokenPairs('solana', t.mint).then((pairs) => usdPriceOf(pairs, t.mint)).catch(() => null);
          if (p) prices.set(t.mint, p);
        }));
        pnl = computePnl(merged, solAt, prices, portfolio ? holdings : undefined);
      }
      Object.assign(names, await namesFor(pnl.tokens.map((t) => t.mint).filter((m) => !names[m])));
      if (c.signal.aborted) return;
      setTxs(merged);
      setState({ pnl, names, scanned: (older ? state?.scanned ?? 0 : 0) + history.scanned, oldest: history.oldest, complete: history.complete, at: Date.now() });
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'The wallet history could not be read.');
    } finally {
      if (!c.signal.aborted) setProgress(null);
    }
  }, [address, state?.oldest, state?.scanned, txs]);

  // Read the wallet when it is connected. Transactions already read come from this device.
  useEffect(() => {
    if (!address) return;
    void run(false);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!solana) {
    return (
      <Card className="mb-6 p-5">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Wallet /></IconTile>Connected wallet profit and loss</h2>
        <p className="mt-2 text-sm text-zinc-400">
          {evm ? 'Wallet trade history is read for Solana wallets for now. Connect Phantom to see your Solana profit and loss here.' : 'Connect Phantom and this shows your wallet’s real profit and loss, worked out from every trade it made.'}
        </p>
      </Card>
    );
  }

  const t = state?.pnl.totals;
  const name = (mint: string) => state?.names[mint]?.symbol ?? STABLE_MINTS[mint] ?? shortAddress(mint, 4, 4);

  return (
    <Card className="mb-6 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="mint" size="sm"><Wallet /></IconTile>Connected wallet profit and loss</h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">Solana <span className="num">{shortAddress(solana.address, 5, 5)}</span><CopyAddress value={solana.address} label="Copy the wallet address" />{state && <> , updated {timeAgo(state.at)}</>}</p>
        </div>
        <div className="flex gap-2">
          {state && !state.complete && <button type="button" disabled={progress != null} onClick={() => void run(true)} className="btn btn-secondary btn-sm"><ClockCounterClockwise className="h-4 w-4" aria-hidden />Read older trades</button>}
          <button type="button" disabled={progress != null} onClick={() => void run(false)} className="btn btn-secondary btn-sm"><ArrowClockwise className="h-4 w-4" aria-hidden />Refresh</button>
        </div>
      </div>

      {progress && (
        <div>
          <p className="flex items-center gap-2 text-sm text-zinc-300"><CircleNotch className="h-4 w-4 animate-spin" aria-hidden />Reading the wallet's transactions{progress.total ? `: ${progress.done} of ${progress.total}` : '…'}</p>
          {progress.total > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full bg-blue-400 transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
          <p className="mt-1 text-[11px] text-zinc-500">The first read can take a minute. Every transaction is kept on this device, so the next visit is quick.</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}

      {t && state && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Net P/L" value={formatUsd(t.netUsd)} tone={pnlClass(t.netUsd)} sub={`${formatUsd(t.realizedUsd)} realized`} />
            <Stat label="Total profit" value={formatUsd(t.profitUsd)} tone="text-emerald-300" />
            <Stat label="Total loss" value={formatUsd(t.lossUsd)} tone="text-rose-300" />
            <Stat label="Total trades" value={String(t.trades)} sub={`${t.buys} buys, ${t.sells} sells${t.swaps ? `, ${t.swaps} token swaps` : ''}`} />
            <Stat label="Win rate" value={t.winRatePct == null ? 'No sells yet' : `${t.winRatePct.toFixed(0)}%`} sub="of tokens sold" />
            <Stat label="Unrealized" value={formatUsd(t.unrealizedUsd)} tone={pnlClass(t.unrealizedUsd)} sub="on what you still hold" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
            <p>Invested <span className="num text-zinc-200">{formatUsd(t.investedUsd)}</span></p>
            <p>Volume <span className="num text-zinc-200">{formatUsd(t.volumeUsd)}</span></p>
            <p>Network fees <span className="num text-zinc-200">{formatUsd(t.feesUsd)}</span></p>
            <p>Since <span className="text-zinc-200">{t.since ? new Date(t.since).toLocaleDateString() : 'no trades found'}</span></p>
          </div>

          {state.pnl.tokens.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Token</th>
                    <th className="py-2 pr-3 text-right font-medium">Trades</th>
                    <th className="py-2 pr-3 text-right font-medium">Invested</th>
                    <th className="py-2 pr-3 text-right font-medium">Avg cost</th>
                    <th className="py-2 pr-3 text-right font-medium">Realized</th>
                    <th className="py-2 pr-3 text-right font-medium">Holding now</th>
                    <th className="py-2 pr-3 text-right font-medium">Unrealized</th>
                    <th className="py-2 text-right font-medium">Total P/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {state.pnl.tokens.map((k) => (
                    <tr key={k.mint}>
                      <td className="py-2 pr-3"><span className="flex items-center gap-1 font-medium text-white">{name(k.mint)}<CopyAddress value={k.mint} label={`Copy ${name(k.mint)} contract address`} /></span><span className="text-[11px] text-zinc-500">since {new Date(k.firstAt).toLocaleDateString()}</span></td>
                      <td className="num py-2 pr-3 text-right text-zinc-300">{k.buys} / {k.sells}</td>
                      <td className="num py-2 pr-3 text-right text-zinc-300">{formatUsd(k.investedUsd)}</td>
                      <td className="num py-2 pr-3 text-right text-zinc-300">{k.avgCostUsd == null ? '—' : formatPrice(k.avgCostUsd)}</td>
                      <td className={`num py-2 pr-3 text-right ${pnlClass(k.realizedUsd)}`}>{formatUsd(k.realizedUsd)}</td>
                      <td className="num py-2 pr-3 text-right text-zinc-300">{k.heldQty > 0 ? <>{k.valueUsd == null ? 'No price' : formatUsd(k.valueUsd)}<span className="block text-[11px] text-zinc-500">{formatNumber(k.heldQty, 4)}</span></> : 'Sold'}</td>
                      <td className={`num py-2 pr-3 text-right ${pnlClass(k.unrealizedUsd)}`}>{k.unrealizedUsd == null ? '—' : formatUsd(k.unrealizedUsd)}</td>
                      <td className={`num py-2 text-right font-semibold ${pnlClass(k.totalUsd)}`}>{formatUsd(k.totalUsd)}{k.investedUsd > 0 && <span className="block text-[11px] font-normal">{formatPct((k.totalUsd / k.investedUsd) * 100, 1)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No buys or sells were found in the transactions read so far.</p>
          )}

          <p className="text-[11px] leading-relaxed text-zinc-500">
            Worked out from the last {state.scanned} transactions of this wallet{state.complete ? ', its whole history' : ''}. Each buy is valued at what you paid at the time (SOL at its price that hour, stablecoins at a dollar), each sell at what came back, with cost averaged per token, and holdings at today's price.
            {(state.pnl.skipped.transfers > 0 || state.pnl.skipped.complex > 0 || state.pnl.skipped.unpriced > 0) && ` Left out: ${[
              state.pnl.skipped.transfers && `${state.pnl.skipped.transfers} transfers in or out (no cost known)`,
              state.pnl.skipped.complex && `${state.pnl.skipped.complex} transactions moving several tokens at once`,
              state.pnl.skipped.unpriced && `${state.pnl.skipped.unpriced} with no SOL price for their time`,
            ].filter(Boolean).join(', ')}.`}
            {!state.complete && ' Read older trades to include earlier buys, which makes the cost of older holdings exact.'}
          </p>
        </>
      )}
    </Card>
  );
}
