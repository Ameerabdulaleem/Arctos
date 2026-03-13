import { useState, useEffect, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ExternalLink,
  Filter,
  Bell,
  Plus,
  X,
  Star,
  Trash2,
  AlertTriangle,
  Wallet,
  Mail,
} from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { WalletConnectionModal } from './WalletConnectionModal';
import { EmailAuthModal } from './EmailAuthModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TxType = 'buy' | 'sell' | 'transfer';
type FilterType = 'all' | TxType;

interface WhaleTransaction {
  id: number;
  type: TxType;
  token: string;
  amount: string;
  valueUsd: number;
  from: string;
  to: string;
  timestamp: Date;
  txHash: string;
  blockchain: string;
}

interface TrackedWhale {
  id: string;
  address: string;
  name: string;
  dateAdded: string; // ISO 8601 — JSON-safe for localStorage and future API
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WHALES_STORAGE_KEY = 'arctos_whales';
const TOKENS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE'];
const BLOCKCHAINS = ['Ethereum', 'BSC', 'Solana', 'Polygon'];
const TX_TYPES: TxType[] = ['buy', 'sell', 'transfer'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function formatDateAdded(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function randomHex(len: number): string {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

function randomAddress(): string {
  return `0x${randomHex(8)}…${randomHex(4)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TYPE_STYLES: Record<TxType, string> = {
  buy: 'bg-green-500/15 text-green-400 border-green-500/30',
  sell: 'bg-red-500/15 text-red-400 border-red-500/30',
  transfer: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

function TypeBadge({ type }: { type: TxType }) {
  const Icon =
    type === 'buy' ? TrendingUp : type === 'sell' ? TrendingDown : ArrowRight;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap ${TYPE_STYLES[type]}`}
    >
      <Icon className="w-3 h-3" />
      {type.toUpperCase()}
    </span>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'blue' | 'default';
}

function StatCard({ label, value, sub, accent = 'default' }: StatCardProps) {
  const valueColor =
    accent === 'green'
      ? 'text-green-400'
      : accent === 'blue'
        ? 'text-blue-400'
        : 'text-white';
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WhaleAlert() {
  const { isAuthenticated } = useAuth();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [emailAuthModalOpen, setEmailAuthModalOpen] = useState(false);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<FilterType>('all');
  const [minValue, setMinValue] = useState('100000');
  const [notifications, setNotifications] = useState(false);
  const [showTrackedOnly, setShowTrackedOnly] = useState(false);

  // ── Tracked whales — persisted via localStorage ──────────────────────────
  const [trackedWhales, setTrackedWhales] = useState<TrackedWhale[]>(() => {
    try {
      const stored = localStorage.getItem(WHALES_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as TrackedWhale[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(WHALES_STORAGE_KEY, JSON.stringify(trackedWhales));
  }, [trackedWhales]);

  // ── Add whale form ────────────────────────────────────────────────────────
  const [showAddWhale, setShowAddWhale] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState('');

  // ── Mock transaction stream ───────────────────────────────────────────────
  const nextIdRef = useRef(1);

  function generateTransaction(): WhaleTransaction {
    const type = TX_TYPES[Math.floor(Math.random() * TX_TYPES.length)];
    const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
    const valueUsd = Math.floor(Math.random() * 4_900_000) + 100_000;
    return {
      id: nextIdRef.current++,
      type,
      token,
      amount: (Math.random() * 1000).toFixed(2),
      valueUsd,
      from: randomAddress(),
      to: randomAddress(),
      timestamp: new Date(Date.now() - Math.random() * 3_600_000),
      txHash: `0x${randomHex(32)}`,
      blockchain: BLOCKCHAINS[Math.floor(Math.random() * BLOCKCHAINS.length)],
    };
  }

  const [transactions, setTransactions] = useState<WhaleTransaction[]>(() =>
    Array.from({ length: 20 }, () => generateTransaction())
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTransactions(prev => [generateTransaction(), ...prev.slice(0, 29)]);
    }, 8_000);
    return () => clearInterval(interval);
  }, []);

  // ── Whale helpers ─────────────────────────────────────────────────────────
  function isTrackedWhale(address: string): boolean {
    return trackedWhales.some(
      w => w.address.toLowerCase() === address.toLowerCase()
    );
  }

  function getWhaleName(address: string): string | undefined {
    return trackedWhales.find(
      w => w.address.toLowerCase() === address.toLowerCase()
    )?.name;
  }

  // ── Add whale handler ─────────────────────────────────────────────────────
  function handleAddWhale() {
    setFormError('');
    if (!newAddress.trim()) {
      setFormError('Wallet address is required.');
      return;
    }
    if (!newName.trim()) {
      setFormError('A label or name is required.');
      return;
    }
    if (
      trackedWhales.some(
        w => w.address.toLowerCase() === newAddress.trim().toLowerCase()
      )
    ) {
      setFormError('This address is already being tracked.');
      return;
    }
    setTrackedWhales(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        address: newAddress.trim(),
        name: newName.trim(),
        dateAdded: new Date().toISOString(),
      },
    ]);
    setNewAddress('');
    setNewName('');
    setShowAddWhale(false);
  }

  function handleRemoveWhale(id: string) {
    setTrackedWhales(prev => prev.filter(w => w.id !== id));
  }

  function closeAddForm() {
    setShowAddWhale(false);
    setNewAddress('');
    setNewName('');
    setFormError('');
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const minValueNum = parseInt(minValue, 10);
  const filtered = transactions.filter(tx => {
    if (filter !== 'all' && tx.type !== filter) return false;
    if (tx.valueUsd < minValueNum) return false;
    if (showTrackedOnly && !isTrackedWhale(tx.from) && !isTrackedWhale(tx.to))
      return false;
    return true;
  });

  const largestValue = transactions.reduce(
    (max, tx) => Math.max(max, tx.valueUsd),
    0
  );
  const avgValue = transactions.length
    ? Math.round(
        transactions.reduce((s, tx) => s + tx.valueUsd, 0) /
          transactions.length
      )
    : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="h-full bg-black p-6 overflow-auto">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-3 tracking-tight">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/15 text-lg leading-none">🐋</span>
              Whale Alerts
            </h1>
            <p className="text-zinc-500 text-sm">
              Real-time monitoring of large on-chain transactions
            </p>
          </div>
          <button
            onClick={() => { setShowAddWhale(v => !v); setFormError(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm shrink-0 shadow-lg shadow-blue-600/10"
          >
            <Plus className="w-4 h-4" />
            Track Whale
          </button>
        </div>

        {/* ── Auth banner ─────────────────────────────────────────────────── */}
        {!isAuthenticated && (
          <div className="mb-6 flex items-center justify-between gap-4 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl">
            <p className="text-zinc-400 text-sm">
              Connect wallet or sign in to sync your tracked whales across devices.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
              >
                <Wallet className="w-3.5 h-3.5" />
                Connect Wallet
              </button>
              <button
                onClick={() => setEmailAuthModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors text-xs font-medium"
              >
                <Mail className="w-3.5 h-3.5" />
                Sign In
              </button>
            </div>
          </div>
        )}

        {/* ── Add Whale Form ───────────────────────────────────────────────── */}
        {showAddWhale && (
          <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">
                Track a Whale Wallet
              </h3>
              <button
                onClick={closeAddForm}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 px-3 py-2.5 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-red-400 text-sm">{formError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Wallet Address <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={e => {
                    setNewAddress(e.target.value);
                    setFormError('');
                  }}
                  placeholder="0x… or Solana address"
                  className="w-full bg-zinc-800 text-white text-sm px-3 py-2.5 rounded-lg border border-zinc-700 focus:border-blue-500 focus:outline-none font-mono placeholder-zinc-600"
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Label / Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => {
                    setNewName(e.target.value);
                    setFormError('');
                  }}
                  placeholder="e.g. Vitalik, Smart Money #1"
                  className="w-full bg-zinc-800 text-white text-sm px-3 py-2.5 rounded-lg border border-zinc-700 focus:border-blue-500 focus:outline-none placeholder-zinc-600"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAddWhale}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                Save Whale
              </button>
              <button
                onClick={closeAddForm}
                className="px-5 py-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Tracked Wallets Panel ────────────────────────────────────────── */}
        {trackedWhales.length > 0 && (
          <div className="mb-6 bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 tracking-tight">
                <Star className="w-4 h-4 text-yellow-500" />
                Tracked Wallets
                <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-full text-xs">
                  {trackedWhales.length}
                </span>
              </h3>
              <button
                onClick={() => setShowTrackedOnly(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  showTrackedOnly
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {showTrackedOnly ? 'Showing tracked only' : 'Show tracked only'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {trackedWhales.map(whale => (
                <div
                  key={whale.id}
                  className="flex items-start justify-between gap-3 p-3 bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 shrink-0" />
                      <span className="text-white text-sm font-semibold truncate">
                        {whale.name}
                      </span>
                    </div>
                    <p className="text-zinc-400 text-xs font-mono truncate">
                      {whale.address}
                    </p>
                    <p className="text-zinc-600 text-xs mt-0.5">
                      Added {formatDateAdded(whale.dateAdded)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveWhale(whale.id)}
                    title="Remove from tracking"
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Stats ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Visible Alerts"
            value={String(filtered.length)}
            sub={`of ${transactions.length} loaded`}
          />
          <StatCard label="Avg Transaction" value={fmtUSD(avgValue)} />
          <StatCard label="Largest (mock)" value={fmtUSD(largestValue)} />
          <StatCard
            label="Tracked Wallets"
            value={String(trackedWhales.length)}
            accent="blue"
          />
        </div>

        {/* ── Filters ──────────────────────────────────────────────────────── */}
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl px-5 py-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <Filter className="w-4 h-4 text-zinc-500" />
              <span className="text-zinc-400 text-sm font-medium">Filters</span>
            </div>

            <div className="flex gap-2 flex-wrap">
              {(['all', 'buy', 'sell', 'transfer'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    filter === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 ml-auto flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 text-xs whitespace-nowrap">
                  Min value
                </span>
                <select
                  value={minValue}
                  onChange={e => setMinValue(e.target.value)}
                  className="bg-zinc-800 text-white text-xs px-3 py-1.5 rounded-lg border border-zinc-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="100000">$100K+</option>
                  <option value="500000">$500K+</option>
                  <option value="1000000">$1M+</option>
                  <option value="5000000">$5M+</option>
                </select>
              </div>

              <button
                onClick={() => setNotifications(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  notifications
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                <Bell className="w-3.5 h-3.5" />
                Alerts {notifications ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Transactions Table ───────────────────────────────────────────── */}
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-800/60 border-b border-zinc-700">
                  {[
                    'Type',
                    'Token',
                    'Amount',
                    'Value (USD)',
                    'From → To',
                    'Chain',
                    'Time',
                    '',
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left px-5 py-3 text-zinc-500 font-medium text-xs uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-14 text-center text-zinc-500 text-sm"
                    >
                      No transactions match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(tx => {
                    const fromTracked = isTrackedWhale(tx.from);
                    const toTracked = isTrackedWhale(tx.to);
                    const highlighted = fromTracked || toTracked;

                    return (
                      <tr
                        key={tx.id}
                        className={`transition-colors ${
                          highlighted
                            ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50 hover:bg-yellow-500/10'
                            : 'hover:bg-zinc-800/40'
                        }`}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <TypeBadge type={tx.type} />
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="text-white font-bold">{tx.token}</span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-zinc-300">
                          {tx.amount}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="text-white font-semibold">
                            ${tx.valueUsd.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span
                              className={`font-mono ${fromTracked ? 'text-yellow-400 font-semibold' : 'text-zinc-500'}`}
                            >
                              {fromTracked && (
                                <Star className="w-2.5 h-2.5 inline fill-yellow-400 text-yellow-400 mr-0.5" />
                              )}
                              {fromTracked ? getWhaleName(tx.from) : tx.from}
                            </span>
                            <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" />
                            <span
                              className={`font-mono ${toTracked ? 'text-yellow-400 font-semibold' : 'text-zinc-500'}`}
                            >
                              {toTracked && (
                                <Star className="w-2.5 h-2.5 inline fill-yellow-400 text-yellow-400 mr-0.5" />
                              )}
                              {toTracked ? getWhaleName(tx.to) : tx.to}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-xs">
                            {tx.blockchain}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-zinc-500 text-xs">
                          {formatTimeAgo(tx.timestamp)}
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            title="View on block explorer"
                            className="p-1.5 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Result count ─────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <p className="mt-3 text-zinc-600 text-xs">
            Showing {filtered.length} transaction
            {filtered.length !== 1 ? 's' : ''}
            {filter !== 'all' ? ` · ${filter}s only` : ''}
            {showTrackedOnly ? ' · tracked wallets only' : ''}
          </p>
        )}
      </div>

      {/* ── Live Feed Indicator ─────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 flex items-center gap-2 px-3 py-2 bg-zinc-900/80 border border-zinc-800/60 rounded-lg shadow-xl z-50 pointer-events-none">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
        <span className="text-zinc-300 text-xs font-medium">Live Feed</span>
      </div>

      <WalletConnectionModal
        open={walletModalOpen}
        onOpenChange={setWalletModalOpen}
      />
      <EmailAuthModal
        open={emailAuthModalOpen}
        onOpenChange={setEmailAuthModalOpen}
      />
    </>
  );
}
