import { useMemo, useState } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';
import { ArrowsDownUp, ChartLineUp, Clock, Flask, Trash, Wallet } from '@phosphor-icons/react';
import { toast } from 'sonner';
import TradingViewChart from './TradingViewChart';
import { Card, Empty, IconTile, PageHeader, PaperBadge } from './ui/common';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { useTickers } from '../hooks/useTickers';
import { marketService, walkBook, type ChartInterval } from '../services/marketService';
import { FEE_RATE } from '../lib/paperTrading';
import { formatNumber, formatPct, formatPrice, formatUsd, pnlClass } from '../lib/format';

const BOOK_ROWS = 8;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'field num';

export function TradingTerminal() {
  const paper = usePaper();
  const { tickers, error: tickerError } = useTickers();
  const [base, setBase] = useState('BTC');
  const [interval, setInterval_] = useState<ChartInterval>('15m');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [qty, setQty] = useState('');
  const [limitPrice, setLimitPrice] = useState('');

  const pairs = useMemo(() => Object.values(tickers).sort((a, b) => b.volumeQuote - a.volumeQuote), [tickers]);
  const ticker = tickers[base];
  const symbol = `${base}USDT`;

  const candles = usePolling((s) => marketService.klines(symbol, interval, 300, s), 3000, [symbol, interval]);
  const depth = usePolling((s) => marketService.depth(symbol, 20, s), 1500, [symbol]);
  const trades = usePolling((s) => marketService.trades(symbol, 24, s), 2000, [symbol]);

  // Switching pairs clears the form so a stale amount cannot be sent to a different asset.
  const selectPair = (next: string) => {
    setBase(next);
    setQty('');
    setLimitPrice('');
  };

  const chartCandles = useMemo<CandlestickData<Time>[]>(
    () => (candles.data ?? []).map((c) => ({ time: c.t as Time, open: c.o, high: c.h, low: c.l, close: c.c })),
    [candles.data],
  );
  const chartVolume = useMemo(
    () => (candles.data ?? []).map((c) => ({ time: c.t as Time, value: c.v, color: c.c >= c.o ? 'rgba(52,211,153,0.35)' : 'rgba(251,113,133,0.35)' })),
    [candles.data],
  );

  const book = depth.data;
  const asks = book ? [...book.asks.slice(0, BOOK_ROWS)].reverse() : [];
  const bids = book ? book.bids.slice(0, BOOK_ROWS) : [];
  const maxSize = Math.max(1e-12, ...asks.map((a) => a[1]), ...bids.map((b) => b[1]));
  const spread = book && book.asks[0] && book.bids[0] ? book.asks[0][0] - book.bids[0][0] : null;

  const position = paper.account.positions[base];
  const quantity = parseFloat(qty);
  const hasQty = Number.isFinite(quantity) && quantity > 0;
  const lastPrice = ticker?.price ?? 0;
  const limit = parseFloat(limitPrice);

  // What a market order would really cost, walking the live order book.
  const marketFill = useMemo(() => {
    if (!hasQty || !book) return null;
    const levels = side === 'buy' ? book.asks : book.bids;
    const { avgPrice, filledQty } = walkBook(levels, quantity);
    return filledQty >= quantity * 0.999999 ? avgPrice : null;
  }, [hasQty, book, side, quantity]);

  const execPrice = orderType === 'market' ? marketFill ?? lastPrice : Number.isFinite(limit) ? limit : 0;
  const notional = hasQty ? quantity * execPrice : 0;
  const fee = notional * FEE_RATE;
  const slippagePct = orderType === 'market' && marketFill && lastPrice ? ((marketFill - lastPrice) / lastPrice) * 100 * (side === 'buy' ? 1 : -1) : null;

  const setPercent = (pct: number) => {
    const price = orderType === 'limit' && Number.isFinite(limit) && limit > 0 ? limit : lastPrice;
    if (!price) return;
    const raw = side === 'buy' ? (paper.availableCash * pct) / 100 / (price * (1 + FEE_RATE)) : ((position?.qty ?? 0) * pct) / 100;
    setQty(raw > 0 ? String(Math.floor(raw * 1e6) / 1e6) : '');
  };

  const submit = () => {
    if (!ticker) return toast.error('Waiting for a live price.');
    if (!hasQty) return toast.error('Enter an amount greater than zero.');
    const meta = { key: base, symbol: base, label: base, source: 'terminal' as const };
    if (orderType === 'limit') {
      if (!Number.isFinite(limit) || limit <= 0) return toast.error('Enter a valid limit price.');
      const r = paper.placeLimit(meta, side, limit, quantity);
      if (!r.ok) return toast.error(r.error);
      toast.success('Limit order placed', { description: `${side} ${quantity} ${base} at ${formatPrice(limit)}. It fills when the live price reaches it.` });
    } else {
      if (marketFill == null) return toast.error('The order book is too thin for that size right now.');
      const r = side === 'buy' ? paper.buyMarket(meta, quantity, marketFill) : paper.sellMarket(base, quantity, marketFill);
      if (!r.ok) return toast.error(r.error);
      toast.success(`Paper ${side} filled`, { description: `${quantity} ${base} at an average ${formatPrice(marketFill)}.` });
    }
    setQty('');
  };

  const myOrders = paper.account.orders.filter((o) => o.key === base);
  const myFills = paper.account.fills.filter((f) => f.key === base).slice(0, 5);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <PageHeader
        icon={<ChartLineUp />} tone="mint" title="Trading Terminal" badge={<PaperBadge />}
        subtitle="Live candles, order book and trades. Orders are simulated against the real order book."
        actions={
          <div className="panel flex items-center gap-2.5 px-3.5 py-2 text-sm text-zinc-400">
            <Wallet className="h-4 w-4 text-violet-300" aria-hidden />
            Paper balance <span className="num font-semibold text-white">{formatUsd(paper.availableCash)}</span>
          </div>
        }
      />

      {pairs.length === 0 ? (
        <Card className="p-6"><Empty title={tickerError ? 'Live prices are unavailable' : 'Connecting to live prices'}>{tickerError ?? 'This takes a moment.'}</Empty></Card>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5" role="tablist" aria-label="Trading pairs">
          {pairs.map((p) => (
            <button
              key={p.base} role="tab" aria-selected={base === p.base} onClick={() => selectPair(p.base)}
              className={`flex shrink-0 items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${base === p.base ? 'border-blue-300/40 bg-blue-400/[0.12] text-white shadow-glow-sm' : 'border-white/[0.07] bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]'}`}
            >
              <span>{p.base}/USDT</span>
              <span className="font-semibold num">{formatPrice(p.price)}</span>
              <span className={`num text-xs ${pnlClass(p.change24hPct)}`}>{formatPct(p.change24hPct)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 space-y-4 min-w-0">
          <TradingViewChart
            symbol={`${base}/USDT`} interval={interval} onIntervalChange={setInterval_}
            candles={chartCandles} volume={chartVolume} loading={candles.loading} error={candles.error && !candles.data ? candles.error : null}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-white"><IconTile tone="ice" size="sm"><ArrowsDownUp /></IconTile>Order book</h3>
              {!book ? <p className="text-sm text-zinc-500 py-6 text-center">{depth.error ?? 'Loading order book...'}</p> : (
                <div className="text-xs num">
                  <div className="grid grid-cols-2 eyebrow text-[10px] mb-1"><span>Price</span><span className="text-right">Size ({base})</span></div>
                  {asks.map(([p, q]) => (
                    <div key={`a${p}`} className="relative grid grid-cols-2 py-0.5">
                      <div className="absolute inset-y-0 right-0 rounded-sm bg-rose-400/[0.12]" style={{ width: `${(q / maxSize) * 100}%` }} />
                      <span className="relative text-rose-300">{formatPrice(p)}</span><span className="relative text-right text-zinc-300">{formatNumber(q, 4)}</span>
                    </div>
                  ))}
                  <div className="my-1.5 border-y border-white/[0.07] py-2 text-center text-sm font-semibold text-white">
                    {formatPrice(lastPrice)} {spread != null && <span className="text-[10px] font-normal text-zinc-500 ml-1">spread {formatPrice(spread)}</span>}
                  </div>
                  {bids.map(([p, q]) => (
                    <div key={`b${p}`} className="relative grid grid-cols-2 py-0.5">
                      <div className="absolute inset-y-0 right-0 rounded-sm bg-emerald-400/[0.12]" style={{ width: `${(q / maxSize) * 100}%` }} />
                      <span className="relative text-emerald-300">{formatPrice(p)}</span><span className="relative text-right text-zinc-300">{formatNumber(q, 4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-white"><IconTile tone="violet" size="sm"><Clock /></IconTile>Recent trades</h3>
              {!trades.data ? <p className="text-sm text-zinc-500 py-6 text-center">{trades.error ?? 'Loading trades...'}</p> : (
                <div className="text-xs num">
                  <div className="grid grid-cols-3 eyebrow text-[10px] mb-1"><span>Price</span><span className="text-right">Size</span><span className="text-right">Time</span></div>
                  {trades.data.slice(0, 18).map((t) => (
                    <div key={t.id} className="grid grid-cols-3 py-0.5">
                      <span className={t.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}>{formatPrice(t.price)}</span>
                      <span className="text-right text-zinc-300">{formatNumber(t.qty, 4)}</span>
                      <span className="text-right text-zinc-500">{new Date(t.time).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="seg mb-3 flex w-full" role="tablist" aria-label="Order side">
              {(['buy', 'sell'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition ${side === s ? (s === 'buy' ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-inset ring-emerald-300/40' : 'bg-rose-400/15 text-rose-200 ring-1 ring-inset ring-rose-300/40') : 'text-zinc-400 hover:text-white'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="seg mb-4 flex w-full">
              {(['market', 'limit'] as const).map((t) => (
                <button key={t} aria-pressed={orderType === t} onClick={() => setOrderType(t)}
                  className="seg-item flex-1 py-1.5 text-xs font-medium capitalize">
                  {t}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {orderType === 'limit' && (
                <Field label="Limit price (USDT)">
                  <input type="number" inputMode="decimal" min="0" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={lastPrice ? lastPrice.toFixed(2) : '0.00'} className={inputClass} />
                </Field>
              )}
              <Field label={`Amount (${base})`}>
                <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.0000" className={inputClass} />
              </Field>
              <div className="grid grid-cols-4 gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button key={pct} onClick={() => setPercent(pct)} className="btn btn-secondary btn-sm num px-0 text-zinc-300">{pct}%</button>
                ))}
              </div>

              <dl className="panel-inset space-y-1.5 p-3 text-xs">
                <div className="flex justify-between"><dt className="text-zinc-500">{side === 'buy' ? 'Available cash' : `Available ${base}`}</dt><dd className="text-white num">{side === 'buy' ? formatUsd(paper.availableCash) : formatNumber(position?.qty ?? 0, 6)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">{orderType === 'market' ? 'Est. average price' : 'Limit price'}</dt><dd className="text-white num">{execPrice ? formatPrice(execPrice) : '—'}</dd></div>
                {slippagePct != null && <div className="flex justify-between"><dt className="text-zinc-500">Slippage vs last</dt><dd className={`num ${slippagePct > 0.2 ? 'text-amber-300' : 'text-zinc-300'}`}>{slippagePct.toFixed(3)}%</dd></div>}
                <div className="flex justify-between"><dt className="text-zinc-500">Fee (0.1%)</dt><dd className="text-zinc-300 num">{formatUsd(fee)}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-500">Total</dt><dd className="text-white font-semibold num">{formatUsd(notional + (side === 'buy' ? fee : -fee))}</dd></div>
              </dl>
              {orderType === 'market' && hasQty && book && marketFill == null && <p role="alert" className="text-xs text-amber-300">The visible order book is too thin for this size.</p>}

              <button onClick={submit} disabled={!ticker}
                className={`btn h-12 w-full text-[15px] ${side === 'buy' ? 'btn-buy' : 'btn-sell'}`}>
                {orderType === 'limit' ? 'Place limit' : side === 'buy' ? 'Buy' : 'Sell'} {base} (paper)
              </button>
              <p className="text-[11px] text-zinc-500 flex items-start gap-1.5"><Flask className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />Simulated order. It uses live prices but no real funds or wallet.</p>
            </div>
          </Card>

          <Card className="p-4">
            <h4 className="eyebrow mb-3">{base}/USDT, 24h</h4>
            {ticker ? (
              <dl className="space-y-2 text-sm">
                {[
                  ['Last price', formatPrice(ticker.price), ''], ['Change', formatPct(ticker.change24hPct), pnlClass(ticker.change24hPct)],
                  ['High', formatPrice(ticker.high24h), ''], ['Low', formatPrice(ticker.low24h), ''],
                  ['Volume', `${formatNumber(ticker.volumeBase, 2)} ${base}`, ''],
                ].map(([k, v, c]) => (
                  <div key={k} className="flex justify-between"><dt className="text-zinc-500 text-xs">{k}</dt><dd className={`font-semibold num ${c || 'text-white'}`}>{v}</dd></div>
                ))}
              </dl>
            ) : <p className="text-sm text-zinc-500">Loading...</p>}
          </Card>

          {(position || myOrders.length > 0 || myFills.length > 0) && (
            <Card className="p-4 space-y-4">
              {position && (
                <div>
                  <h4 className="eyebrow mb-2">Your position</h4>
                  <p className="text-white text-sm font-semibold num">{formatNumber(position.qty, 6)} {base}</p>
                  <p className="text-xs text-zinc-500">Average cost {formatPrice(position.avgPrice)}</p>
                  {lastPrice > 0 && <p className={`text-xs num ${pnlClass(lastPrice - position.avgPrice)}`}>{formatUsd((lastPrice - position.avgPrice) * position.qty)} ({formatPct((lastPrice / position.avgPrice - 1) * 100)})</p>}
                </div>
              )}
              {myOrders.length > 0 && (
                <div>
                  <h4 className="eyebrow mb-2">Open orders</h4>
                  <ul className="space-y-1.5">
                    {myOrders.map((o) => (
                      <li key={o.id} className="flex items-center justify-between text-xs">
                        <span className={o.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}>{o.side} {formatNumber(o.qty, 6)} at {formatPrice(o.price)}</span>
                        <button onClick={() => paper.cancelOrder(o.id)} className="p-1 text-zinc-500 hover:text-rose-300" aria-label="Cancel order"><Trash className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {myFills.length > 0 && (
                <div>
                  <h4 className="eyebrow mb-2">Recent fills</h4>
                  <ul className="space-y-1">
                    {myFills.map((f) => (
                      <li key={f.id} className="text-xs text-zinc-400 flex justify-between"><span>{f.side} {formatNumber(f.qty, 6)} at {formatPrice(f.price)}</span>{f.realizedPnlUsd != null && <span className={pnlClass(f.realizedPnlUsd)}>{formatUsd(f.realizedPnlUsd)}</span>}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
