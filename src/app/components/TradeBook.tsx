import { useState, useMemo, useEffect } from 'react';
import { CaretDown, CaretUp, CaretUpDown, Check, DownloadSimple, MagnifyingGlass, PencilSimple, Notebook, Plus, Trash, TrendDown, TrendUp, Warning, X } from '@phosphor-icons/react';
import { useTickers } from '../hooks/useTickers';
import { IconTile } from './ui/common';
import { usePolling } from '../hooks/usePolling';
import { marketService } from '../services/marketService';
import { readTrades, tradesToCsv, TRADEBOOK_KEY } from '../lib/tradebook';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trade {
  id: string;
  tokenName: string;
  priceBought: string;
  amount: string;
  priceSold: string;
  profitLoss: number;
  date: string; // ISO string — safe for JSON serialization / future API mapping
}

type SortField = 'date' | 'token' | 'pl' | 'invested';
type SortDir = 'asc' | 'desc';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = TRADEBOOK_KEY;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcPL(bought: string, sold: string, amt: string): number {
  const b = parseFloat(bought);
  const s = parseFloat(sold || '0');
  const a = parseFloat(amt);
  if (!b || !a || isNaN(b) || isNaN(a)) return 0;
  return s * a - b * a;
}

function calcPLPct(bought: string, sold: string): number | null {
  const b = parseFloat(bought);
  const s = parseFloat(sold || '0');
  if (!b || !s || isNaN(b) || isNaN(s)) return null;
  return ((s - b) / b) * 100;
}

function isOpen(trade: Trade): boolean {
  return !trade.priceSold || parseFloat(trade.priceSold) === 0;
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-semibold num ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function SortButton({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortBy === field;
  const Icon = !active ? CaretUpDown : sortDir === 'asc' ? CaretUp : CaretDown;
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors ${
        active ? 'text-blue-300' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
      <Icon className="w-3 h-3" />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TradeBook() {
  const { tickers } = useTickers();
  const coins = usePolling((s) => marketService.coins(100, s), 60_000);

  // ── State ──────────────────────────────────────────────────────────────────

  const [trades, setTrades] = useState<Trade[]>(readTrades);

  // Live price for a trade's token, matched by symbol against exchange tickers first, then the top 100 coins.
  const livePrice = (name: string): number | null => {
    const sym = name.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '');
    if (tickers[sym]) return tickers[sym].price;
    return coins.data?.coins.find((c) => c.symbol === sym)?.price ?? null;
  };

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form fields
  const [tokenName, setTokenName] = useState('');
  const [priceBought, setPriceBought] = useState('');
  const [amount, setAmount] = useState('');
  const [priceSold, setPriceSold] = useState('');

  // Table controls
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Form error
  const [formError, setFormError] = useState<string | null>(null);

  // ── Persistence ────────────────────────────────────────────────────────────
  // The trade book is stored in this browser. Use Settings to back it up or move it.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    } catch {
      // storage full / unavailable — fail silently
    }
  }, [trades]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const closedTrades = useMemo(() => trades.filter((t) => !isOpen(t)), [trades]);
  const openTrades = useMemo(() => trades.filter(isOpen), [trades]);
  const totalProfit = useMemo(
    () => closedTrades.reduce((s, t) => s + (t.profitLoss > 0 ? t.profitLoss : 0), 0),
    [closedTrades],
  );
  const totalLoss = useMemo(
    () => closedTrades.reduce((s, t) => s + (t.profitLoss < 0 ? Math.abs(t.profitLoss) : 0), 0),
    [closedTrades],
  );
  const netPL = useMemo(() => closedTrades.reduce((s, t) => s + t.profitLoss, 0), [closedTrades]);
  const winningTrades = useMemo(() => closedTrades.filter((t) => t.profitLoss > 0).length, [closedTrades]);
  const openPL = openTrades.reduce((sum, t) => {
    const price = livePrice(t.tokenName);
    return price == null ? sum : sum + (price - parseFloat(t.priceBought)) * parseFloat(t.amount);
  }, 0);
  const openPriced = openTrades.filter((t) => livePrice(t.tokenName) != null).length;
  const winRate = useMemo(
    () => (closedTrades.length > 0 ? ((winningTrades / closedTrades.length) * 100).toFixed(1) : '—'),
    [closedTrades, winningTrades],
  );

  // ── Filtered + sorted table rows ───────────────────────────────────────────

  const displayedTrades = useMemo(() => {
    let rows = [...trades];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((t) => t.tokenName.toLowerCase().includes(q));
    }

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
      else if (sortBy === 'token') cmp = a.tokenName.localeCompare(b.tokenName);
      else if (sortBy === 'pl') cmp = a.profitLoss - b.profitLoss;
      else if (sortBy === 'invested')
        cmp =
          parseFloat(a.priceBought) * parseFloat(a.amount) -
          parseFloat(b.priceBought) * parseFloat(b.amount);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [trades, search, sortBy, sortDir]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir('desc'); }
  }

  function validateForm(): boolean {
    if (!tokenName.trim()) { setFormError('Token name is required.'); return false; }
    const b = parseFloat(priceBought);
    const a = parseFloat(amount);
    if (!priceBought || isNaN(b) || b <= 0) { setFormError('Price Bought must be a positive number.'); return false; }
    if (!amount || isNaN(a) || a <= 0) { setFormError('Amount must be a positive number.'); return false; }
    if (priceSold) {
      const s = parseFloat(priceSold);
      if (isNaN(s) || s < 0) { setFormError('Price Sold must be 0 or a positive number.'); return false; }
    }
    setFormError(null);
    return true;
  }

  function handleAddTrade() {
    if (!validateForm()) return;
    const pl = calcPL(priceBought, priceSold, amount);
    const newTrade: Trade = {
      id: crypto.randomUUID(),
      tokenName: tokenName.trim(),
      priceBought,
      amount,
      priceSold: priceSold || '0',
      profitLoss: pl,
      date: new Date().toISOString(),
    };
    setTrades((prev) => [newTrade, ...prev]);
    resetForm();
    setShowForm(false);
  }

  function handleUpdateTrade(id: string) {
    if (!validateForm()) return;
    const pl = calcPL(priceBought, priceSold, amount);
    setTrades((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, tokenName: tokenName.trim(), priceBought, amount, priceSold: priceSold || '0', profitLoss: pl }
          : t,
      ),
    );
    resetForm();
    setEditingId(null);
    setShowForm(false);
  }

  function handleEditTrade(trade: Trade) {
    setTokenName(trade.tokenName);
    setPriceBought(trade.priceBought);
    setAmount(trade.amount);
    setPriceSold(trade.priceSold === '0' ? '' : trade.priceSold);
    setEditingId(trade.id);
    setFormError(null);
    setShowForm(true);
  }

  function handleDeleteTrade(id: string) {
    setTrades((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
  }

  function resetForm() {
    setTokenName('');
    setPriceBought('');
    setAmount('');
    setPriceSold('');
    setFormError(null);
  }

  function handleCancel() {
    resetForm();
    setShowForm(false);
    setEditingId(null);
  }

  // ── current P/L preview (live while typing) ────────────────────────────────
  const previewPL = calcPL(priceBought, priceSold, amount);
  const previewPLPct = calcPLPct(priceBought, priceSold);
  const previewPositive = previewPL >= 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="mx-auto h-full max-w-[1500px] overflow-auto p-4 md:p-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between motion-safe:animate-fade-up">
          <div className="flex min-w-0 items-center gap-4">
            <IconTile tone="violet" size="lg"><Notebook /></IconTile>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px] sm:leading-8">Trade Book</h1>
              <p className="mt-1 text-sm text-zinc-400">Log your trades. Open positions are marked to live prices. Saved in this browser.</p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
          {trades.length > 0 && (
            <button
              onClick={() => {
                const url = URL.createObjectURL(new Blob([tradesToCsv(trades)], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'arctos-trade-book.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn btn-secondary px-4 py-2"
            >
              <DownloadSimple className="w-4 h-4" /> Export CSV
            </button>
          )}
          <button
            onClick={() => { resetForm(); setEditingId(null); setShowForm((v) => !v); }}
            className="btn btn-primary px-4 py-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Trade
          </button>
          </div>
        </div>

        {/* ── Stats ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard
            label="Total Trades"
            value={String(trades.length)}
            sub={`${openTrades.length} open · ${closedTrades.length} closed`}
          />
          <StatCard
            label="Win Rate"
            value={winRate === '—' ? '—' : `${winRate}%`}
            sub={closedTrades.length > 0 ? `${winningTrades}W / ${closedTrades.length - winningTrades}L` : 'No closed trades'}
          />
          <StatCard label="Total Profit" value={fmtUSD(totalProfit)} color="text-green-500" />
          <StatCard label="Total Loss" value={fmtUSD(totalLoss)} color="text-red-500" />
          <StatCard
            label="Net P/L"
            value={fmtUSD(netPL)}
            color={netPL >= 0 ? 'text-green-500' : 'text-red-500'}
            sub="Closed trades only"
          />
          <StatCard
            label="Open P/L (live)"
            value={openPriced > 0 ? fmtUSD(openPL) : '\u2014'}
            color={openPriced === 0 ? undefined : openPL >= 0 ? 'text-green-500' : 'text-red-500'}
            sub={openTrades.length === 0 ? 'No open trades' : `${openPriced} of ${openTrades.length} open priced live`}
          />
        </div>

        {/* ── Add / Edit form ─────────────────────────────────────────────── */}
        {showForm && (
          <div className="mb-6 panel p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">
                {editingId ? 'Edit Trade' : 'Add New Trade'}
              </h3>
              <button
                onClick={handleCancel}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/[0.08] rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
              {/* Token name */}
              <div>
                <label className="block text-zinc-300 text-xs font-medium uppercase tracking-wider mb-1.5">
                  Token Name
                </label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="e.g. BTC, ETH"
                  className="field"
                />
              </div>

              {/* Price bought */}
              <div>
                <label className="block text-zinc-300 text-xs font-medium uppercase tracking-wider mb-1.5">
                  Price Bought ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={priceBought}
                  onChange={(e) => setPriceBought(e.target.value)}
                  placeholder="0.00"
                  className="field"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-zinc-300 text-xs font-medium uppercase tracking-wider mb-1.5">
                  Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="field"
                />
              </div>

              {/* Price sold */}
              <div>
                <label className="block text-zinc-300 text-xs font-medium uppercase tracking-wider mb-1.5">
                  Price Sold ($) <span className="text-zinc-600 normal-case font-normal">optional</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={priceSold}
                  onChange={(e) => setPriceSold(e.target.value)}
                  placeholder="Leave blank if open"
                  className="field"
                />
              </div>

              {/* Live P/L preview */}
              <div>
                <label className="block text-zinc-300 text-xs font-medium uppercase tracking-wider mb-1.5">
                  P/L Preview
                </label>
                <div
                  className={`w-full px-3 py-2.5 rounded-lg border font-semibold flex items-center justify-between text-sm ${
                    previewPositive
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border-red-500/30 text-rose-300'
                  }`}
                >
                  <span>
                    {previewPositive ? '+' : '-'}
                    {fmtUSD(Math.abs(previewPL))}
                    {previewPLPct !== null && (
                      <span className="ml-1 text-xs font-normal opacity-70">
                        ({previewPLPct >= 0 ? '+' : ''}{previewPLPct.toFixed(1)}%)
                      </span>
                    )}
                  </span>
                  {previewPositive ? (
                    <TrendUp className="w-4 h-4" />
                  ) : (
                    <TrendDown className="w-4 h-4" />
                  )}
                </div>
              </div>
            </div>

            {/* Form error */}
            {formError && (
              <div className="flex items-center gap-2 text-rose-300 text-sm mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Warning className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              {editingId ? (
                <button
                  onClick={() => handleUpdateTrade(editingId)}
                  className="btn btn-primary flex-1 px-5 py-2.5"
                >
                  <Check className="w-4 h-4" />
                  Update Trade
                </button>
              ) : (
                <button
                  onClick={handleAddTrade}
                  className="btn btn-primary flex-1 px-5 py-2.5"
                >
                  Save Trade
                </button>
              )}
              <button
                onClick={handleCancel}
                className="px-5 py-2.5 bg-white/[0.06] text-zinc-300 rounded-lg hover:bg-white/[0.1] hover:text-white transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {trades.length === 0 ? (
          <div className="panel p-14 text-center">
            <Notebook className="w-14 h-14 text-zinc-700 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No trades recorded yet</h3>
            <p className="text-zinc-400 text-sm mb-6">
              Start tracking your trades by clicking the "Add Trade" button above.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="btn btn-primary px-5 py-2.5"
            >
              <Plus className="w-4 h-4" />
              Add Your First Trade
            </button>
          </div>
        ) : (
          <>
            {/* ── Search + sort bar ──────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1 max-w-xs">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search token..."
                  className="field pl-9 pr-3"
                />
              </div>

              <p className="text-zinc-500 text-xs self-center ml-auto">
                {displayedTrades.length} of {trades.length} trade{trades.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* ── Trades table ───────────────────────────────────────────── */}
            <div className="panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/[0.04] border-b border-white/10">
                    <tr>
                      <th className="text-left px-5 py-3.5">
                        <SortButton field="token" label="Token" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-left px-5 py-3.5 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                        Price Bought
                      </th>
                      <th className="text-left px-5 py-3.5 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="text-left px-5 py-3.5 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                        Price Sold
                      </th>
                      <th className="text-left px-5 py-3.5">
                        <SortButton field="invested" label="Invested" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-left px-5 py-3.5 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                        Returned
                      </th>
                      <th className="text-left px-5 py-3.5">
                        <SortButton field="pl" label="P / L" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-left px-5 py-3.5">
                        <SortButton field="date" label="Date" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-left px-5 py-3.5 text-zinc-400 text-xs font-medium uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-white/[0.06]">
                    {displayedTrades.map((trade) => {
                      const invested = parseFloat(trade.priceBought) * parseFloat(trade.amount);
                      const returned = parseFloat(trade.priceSold) * parseFloat(trade.amount);
                      const plPct = calcPLPct(trade.priceBought, trade.priceSold);
                      const isProfitable = trade.profitLoss >= 0;
                      const tradeOpen = isOpen(trade);
                      const isDeleting = confirmDeleteId === trade.id;

                      return (
                        <tr
                          key={trade.id}
                          className={`transition-colors ${isDeleting ? 'bg-red-500/5' : 'hover:bg-white/[0.04]'}`}
                        >
                          {/* Token + status */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-semibold text-sm">{trade.tokenName}</span>
                              <span
                                className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider ${
                                  tradeOpen
                                    ? 'bg-blue-500/15 text-blue-300 border border-blue-500/20'
                                    : 'bg-zinc-700/50 text-zinc-400 border border-white/10'
                                }`}
                              >
                                {tradeOpen ? 'Open' : 'Closed'}
                              </span>
                            </div>
                          </td>

                          {/* Price bought */}
                          <td className="px-5 py-3.5">
                            <span className="text-zinc-300 text-sm">
                              {fmtUSD(parseFloat(trade.priceBought))}
                            </span>
                          </td>

                          {/* Amount */}
                          <td className="px-5 py-3.5">
                            <span className="text-zinc-300 text-sm">
                              {parseFloat(trade.amount).toLocaleString('en-US', { maximumFractionDigits: 6 })}
                            </span>
                          </td>

                          {/* Price sold */}
                          <td className="px-5 py-3.5">
                            <span className="text-zinc-300 text-sm">
                              {tradeOpen ? (
                                <span className="text-zinc-600">—</span>
                              ) : (
                                fmtUSD(parseFloat(trade.priceSold))
                              )}
                            </span>
                          </td>

                          {/* Total invested */}
                          <td className="px-5 py-3.5">
                            <span className="text-white text-sm font-medium">{fmtUSD(invested)}</span>
                          </td>

                          {/* Total returned */}
                          <td className="px-5 py-3.5">
                            <span className="text-white text-sm font-medium">
                              {tradeOpen ? <span className="text-zinc-600">—</span> : fmtUSD(returned)}
                            </span>
                          </td>

                          {/* P/L */}
                          <td className="px-5 py-3.5">
                            {tradeOpen ? (
                              (() => {
                                const live = livePrice(trade.tokenName);
                                if (live == null) return <span className="text-zinc-600 text-sm" title="No live price found for this token symbol">—</span>;
                                const unreal = (live - parseFloat(trade.priceBought)) * parseFloat(trade.amount);
                                return (
                                  <span className={`text-sm font-semibold num ${unreal >= 0 ? 'text-green-400' : 'text-rose-300'}`} title={`Live price ${fmtUSD(live)}`}>
                                    {unreal >= 0 ? '+' : '-'}{fmtUSD(Math.abs(unreal))}
                                    <span className="ml-1 text-[10px] font-normal text-zinc-500">live</span>
                                  </span>
                                );
                              })()
                            ) : (
                              <div
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  isProfitable
                                    ? 'bg-green-500/15 text-green-400'
                                    : 'bg-red-500/15 text-rose-300'
                                }`}
                              >
                                {isProfitable ? <TrendUp className="w-3 h-3" /> : <TrendDown className="w-3 h-3" />}
                                <span>
                                  {isProfitable ? '+' : '-'}
                                  {fmtUSD(Math.abs(trade.profitLoss))}
                                </span>
                                {plPct !== null && (
                                  <span className="opacity-70">
                                    ({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Date */}
                          <td className="px-5 py-3.5">
                            <span className="text-zinc-500 text-xs whitespace-nowrap">{fmtDate(trade.date)}</span>
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5">
                            {isDeleting ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-zinc-400 text-xs mr-1">Delete?</span>
                                <button
                                  onClick={() => handleDeleteTrade(trade.id)}
                                  className="p-1.5 text-rose-300 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                                  title="Confirm delete"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/[0.1] rounded transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleEditTrade(trade)}
                                  className="p-1.5 text-blue-300 hover:text-blue-200 hover:bg-blue-500/10 rounded transition-colors"
                                  title="Edit trade"
                                >
                                  <PencilSimple className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(trade.id)}
                                  className="p-1.5 text-zinc-500 hover:text-rose-300 hover:bg-red-500/10 rounded transition-colors"
                                  title="Delete trade"
                                >
                                  <Trash className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {displayedTrades.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-center py-12 text-zinc-500 text-sm">
                          No trades match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
