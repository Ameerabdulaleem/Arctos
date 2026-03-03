import { useState, useMemo, useCallback } from 'react';
import {
  Wallet,
  Zap,
  BarChart3,
  ArrowUpDown,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { toast } from 'sonner';
import { WalletConnectionModal } from './WalletConnectionModal';
import TradingViewChart, { type ChartInterval } from './TradingViewChart';
import AutomatedTrading from './AutomatedTrading';

/* ------------------------------------------------------------------ */
/*  Static mock data (replaced by live feed once backend is wired)     */
/* ------------------------------------------------------------------ */

interface TradingPair {
  pair: string;
  price: string;
  priceNum: number;
  change: string;
  isPositive: boolean;
  volume24h: string;
}

const TRADING_PAIRS: TradingPair[] = [
  { pair: 'BTC/USDT',  price: '$45,234.56', priceNum: 45234.56, change: '+2.50%', isPositive: true,  volume24h: '$1.2B' },
  { pair: 'ETH/USDT',  price: '$2,345.67',  priceNum: 2345.67,  change: '+1.80%', isPositive: true,  volume24h: '$820M' },
  { pair: 'BNB/USDT',  price: '$312.45',    priceNum: 312.45,   change: '-0.50%', isPositive: false, volume24h: '$310M' },
  { pair: 'SOL/USDT',  price: '$98.76',     priceNum: 98.76,    change: '+5.20%', isPositive: true,  volume24h: '$540M' },
  { pair: 'ARB/USDT',  price: '$1.24',      priceNum: 1.24,     change: '+3.10%', isPositive: true,  volume24h: '$180M' },
  { pair: 'AVAX/USDT', price: '$35.42',     priceNum: 35.42,    change: '-1.20%', isPositive: false, volume24h: '$210M' },
];

interface Trade {
  price: string;
  amount: string;
  time: string;
  type: 'buy' | 'sell';
}

function generateRecentTrades(priceNum: number): Trade[] {
  const trades: Trade[] = [];
  for (let i = 0; i < 12; i++) {
    const isBuy = Math.random() > 0.45;
    const p = priceNum + (Math.random() - 0.5) * priceNum * 0.002;
    trades.push({
      price: p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      amount: (Math.random() * 2).toFixed(4),
      time: new Date(Date.now() - i * 1200).toLocaleTimeString(),
      type: isBuy ? 'buy' : 'sell',
    });
  }
  return trades;
}

/* Simple 6-level order book mock */
function generateOrderBook(priceNum: number) {
  const asks: { price: string; amount: string; total: string }[] = [];
  const bids: { price: string; amount: string; total: string }[] = [];
  let askTotal = 0;
  let bidTotal = 0;

  for (let i = 0; i < 6; i++) {
    const askP = priceNum + (i + 1) * priceNum * 0.0003;
    const askA = +(Math.random() * 3 + 0.1).toFixed(4);
    askTotal += askA;
    asks.push({
      price: askP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      amount: askA.toFixed(4),
      total: askTotal.toFixed(4),
    });

    const bidP = priceNum - (i + 1) * priceNum * 0.0003;
    const bidA = +(Math.random() * 3 + 0.1).toFixed(4);
    bidTotal += bidA;
    bids.push({
      price: bidP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      amount: bidA.toFixed(4),
      total: bidTotal.toFixed(4),
    });
  }

  return { asks: asks.reverse(), bids };
}

/* ------------------------------------------------------------------ */
/*  Sub-tab type                                                       */
/* ------------------------------------------------------------------ */

type TerminalTab = 'manual' | 'auto';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TradingTerminal() {
  const { isWalletConnected, user } = useAuth();

  /* General state */
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [terminalTab, setTerminalTab] = useState<TerminalTab>('manual');
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);
  const [chartInterval, setChartInterval] = useState<ChartInterval>('15m');

  /* Order form */
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');

  /* Derived mock data */
  const recentTrades = useMemo(() => generateRecentTrades(selectedPair.priceNum), [selectedPair]);
  const orderBook = useMemo(() => generateOrderBook(selectedPair.priceNum), [selectedPair]);

  /* Percentage amount helpers */
  const setPercentAmount = useCallback(
    (pct: number) => {
      // In production this would calculate from wallet balance
      const mockBalance = 1.5; // e.g. 1.5 BTC
      setAmount(((mockBalance * pct) / 100).toFixed(4));
    },
    [],
  );

  /* Estimated total */
  const estimatedTotal = useMemo(() => {
    const qty = parseFloat(amount) || 0;
    const p = orderType === 'limit' && price ? parseFloat(price) : selectedPair.priceNum;
    return (qty * p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [amount, price, orderType, selectedPair]);

  /* Order submission */
  const handleTrade = () => {
    if (!isWalletConnected) {
      toast.error('Please connect your wallet to trade');
      setWalletModalOpen(true);
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (orderType === 'limit' && (!price || parseFloat(price) <= 0)) {
      toast.error('Enter a valid limit price');
      return;
    }

    toast.success(`${activeTab.toUpperCase()} order placed`, {
      description: `${amount} ${selectedPair.pair.split('/')[0]} at ${orderType === 'market' ? 'market' : `$${price}`}`,
    });
    setAmount('');
    setPrice('');
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="h-full bg-black p-4 md:p-6 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Trading Terminal</h1>
          <p className="text-zinc-500 text-sm">Professional trading with live charts &amp; automated execution</p>
        </div>

        {/* Tab switches */}
        <div className="flex items-center gap-2">
          <TabButton
            active={terminalTab === 'manual'}
            onClick={() => setTerminalTab('manual')}
            icon={<BarChart3 className="w-4 h-4" />}
            label="Manual"
          />
          <TabButton
            active={terminalTab === 'auto'}
            onClick={() => setTerminalTab('auto')}
            icon={<Zap className="w-4 h-4" />}
            label="Auto"
          />
        </div>
      </div>

      {/* -------------------------------------------------------------- */}
      {/*  MANUAL TRADING                                                 */}
      {/* -------------------------------------------------------------- */}
      {terminalTab === 'manual' && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* -------- Left: Chart (spans 3 cols on xl) -------- */}
          <div className="xl:col-span-3 space-y-4">
            {/* Pair quick bar */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {TRADING_PAIRS.map((p) => (
                <button
                  key={p.pair}
                  onClick={() => setSelectedPair(p)}
                  className={`flex-shrink-0 flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedPair.pair === p.pair
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <span>{p.pair}</span>
                  <span className="font-bold">{p.price}</span>
                  <span className={`text-xs ${p.isPositive ? 'text-green-400' : 'text-red-400'}`}>{p.change}</span>
                </button>
              ))}
            </div>

            {/* TradingView chart */}
            <TradingViewChart symbol={selectedPair.pair} interval={chartInterval} onIntervalChange={setChartInterval} />

            {/* Order book + recent trades (side by side on larger screens) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Order Book */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4" /> Order Book
                </h3>
                {/* Asks */}
                <div className="space-y-0.5 mb-2">
                  {orderBook.asks.map((a, i) => (
                    <div key={`a${i}`} className="grid grid-cols-3 text-xs tabular-nums">
                      <span className="text-red-400">{a.price}</span>
                      <span className="text-zinc-400 text-right">{a.amount}</span>
                      <span className="text-zinc-600 text-right">{a.total}</span>
                    </div>
                  ))}
                </div>
                {/* Spread indicator */}
                <div className="text-center py-1 text-sm font-bold text-white border-y border-zinc-800 my-1">
                  {selectedPair.price}
                </div>
                {/* Bids */}
                <div className="space-y-0.5 mt-2">
                  {orderBook.bids.map((b, i) => (
                    <div key={`b${i}`} className="grid grid-cols-3 text-xs tabular-nums">
                      <span className="text-green-400">{b.price}</span>
                      <span className="text-zinc-400 text-right">{b.amount}</span>
                      <span className="text-zinc-600 text-right">{b.total}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Trades */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Recent Trades
                </h3>
                <div className="grid grid-cols-3 text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                  <span>Price</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Time</span>
                </div>
                <div className="space-y-0.5">
                  {recentTrades.map((t, i) => (
                    <div key={i} className="grid grid-cols-3 text-xs tabular-nums">
                      <span className={t.type === 'buy' ? 'text-green-400' : 'text-red-400'}>{t.price}</span>
                      <span className="text-zinc-400 text-right">{t.amount}</span>
                      <span className="text-zinc-600 text-right">{t.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* -------- Right: Order panel (1 col on xl) -------- */}
          <div className="space-y-4">
            {/* Buy/Sell panel */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              {/* Buy / Sell tabs */}
              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => setActiveTab('buy')}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    activeTab === 'buy'
                      ? 'bg-green-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setActiveTab('sell')}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    activeTab === 'sell'
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Sell
                </button>
              </div>

              {/* Order type */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setOrderType('market')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    orderType === 'market'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Market
                </button>
                <button
                  onClick={() => setOrderType('limit')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    orderType === 'limit'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Limit
                </button>
              </div>

              <div className="space-y-3">
                {/* Limit price input */}
                {orderType === 'limit' && (
                  <div>
                    <label className="text-zinc-400 text-xs mb-1.5 block">Price (USDT)</label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={selectedPair.priceNum.toFixed(2)}
                      className="w-full bg-zinc-800 text-white px-3 py-2.5 rounded-lg border border-zinc-700 focus:border-blue-600 focus:outline-none text-sm tabular-nums"
                    />
                  </div>
                )}

                {/* Amount input */}
                <div>
                  <label className="text-zinc-400 text-xs mb-1.5 block">
                    Amount ({selectedPair.pair.split('/')[0]})
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0000"
                    className="w-full bg-zinc-800 text-white px-3 py-2.5 rounded-lg border border-zinc-700 focus:border-blue-600 focus:outline-none text-sm tabular-nums"
                  />
                </div>

                {/* Percentage buttons */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setPercentAmount(pct)}
                      className="py-1.5 bg-zinc-800 text-zinc-400 rounded text-xs hover:bg-zinc-700 hover:text-white transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>

                {/* Summary */}
                <div className="p-3 bg-zinc-800/60 rounded-lg space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Available</span>
                    <span className="text-white tabular-nums">
                      {isWalletConnected ? '1.5000' : '0.0000'} {selectedPair.pair.split('/')[0]}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Est. Total</span>
                    <span className="text-white font-semibold tabular-nums">${estimatedTotal} USDT</span>
                  </div>
                  {orderType === 'market' && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Slippage est.</span>
                      <span className="text-zinc-400">~0.1%</span>
                    </div>
                  )}
                </div>

                {/* Execute button */}
                {isWalletConnected ? (
                  <button
                    onClick={handleTrade}
                    className={`w-full py-3.5 rounded-lg font-bold text-white text-sm transition-colors ${
                      activeTab === 'buy'
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {activeTab === 'buy' ? 'Buy' : 'Sell'} {selectedPair.pair.split('/')[0]}
                  </button>
                ) : (
                  <button
                    onClick={() => setWalletModalOpen(true)}
                    className="w-full py-3.5 rounded-lg font-bold text-white text-sm bg-blue-600 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4" /> Connect Wallet to Trade
                  </button>
                )}
              </div>
            </div>

            {/* Market info card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                {selectedPair.pair} Info
              </h4>
              <div className="space-y-2 text-xs">
                <InfoRow label="Last Price" value={selectedPair.price} />
                <InfoRow label="24h Change" value={selectedPair.change} color={selectedPair.isPositive ? 'text-green-400' : 'text-red-400'} />
                <InfoRow label="24h Volume" value={selectedPair.volume24h} />
                <InfoRow label="Order Type" value={orderType.charAt(0).toUpperCase() + orderType.slice(1)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- */}
      {/*  AUTOMATED TRADING                                              */}
      {/* -------------------------------------------------------------- */}
      {terminalTab === 'auto' && (
        <AutomatedTrading
          isWalletConnected={isWalletConnected}
          walletAddress={user?.walletAddress}
          onRequestWalletConnect={() => setWalletModalOpen(true)}
        />
      )}

      {/* Wallet Connection Modal */}
      <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Utility sub-components                                             */
/* ------------------------------------------------------------------ */

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function InfoRow({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}
