import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  Search,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Pause,
  Play,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SupportedChain = 'solana' | 'ethereum' | 'bnb' | 'base' | 'arbitrum';

interface TokenCandidate {
  id: string;
  name: string;
  symbol: string;
  chain: SupportedChain;
  contractAddress: string;
  creatorAddress: string;
  creatorWinRate: number;       // 0–100
  liquidityUsd: number;
  marketCapUsd: number;
  ageMinutes: number;
  riskScore: number;            // 0–100 (lower = safer)
  signalStrength: number;       // 0–100 (higher = stronger)
  holders: number;
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
  status: 'pending' | 'bought' | 'sold' | 'skipped' | 'failed';
  pnlPercent?: number;
}

interface AutoTradeConfig {
  chain: SupportedChain;
  maxBuyAmountUsd: number;
  minCreatorWinRate: number;
  maxRiskScore: number;
  minLiquidityUsd: number;
  minSignalStrength: number;
  autoTakeProfit: number;       // percent
  autoStopLoss: number;         // percent
  maxOpenPositions: number;
  slippageTolerance: number;    // percent
}

interface AutomatedTradingProps {
  isWalletConnected: boolean;
  walletAddress?: string;
  onRequestWalletConnect: () => void;
}

/* ------------------------------------------------------------------ */
/*  Chain config                                                       */
/* ------------------------------------------------------------------ */

const CHAIN_META: Record<SupportedChain, { label: string; color: string; explorer: string }> = {
  solana:   { label: 'Solana',   color: 'bg-purple-500', explorer: 'https://solscan.io/token/' },
  ethereum: { label: 'Ethereum', color: 'bg-blue-500',   explorer: 'https://etherscan.io/token/' },
  bnb:      { label: 'BNB',     color: 'bg-yellow-500',  explorer: 'https://bscscan.com/token/' },
  base:     { label: 'Base',    color: 'bg-sky-500',     explorer: 'https://basescan.org/token/' },
  arbitrum: { label: 'Arbitrum', color: 'bg-cyan-500',   explorer: 'https://arbiscan.io/token/' },
};

const CHAINS: SupportedChain[] = ['solana', 'ethereum', 'bnb', 'base', 'arbitrum'];

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG: AutoTradeConfig = {
  chain: 'solana',
  maxBuyAmountUsd: 50,
  minCreatorWinRate: 60,
  maxRiskScore: 40,
  minLiquidityUsd: 5000,
  minSignalStrength: 65,
  autoTakeProfit: 100,
  autoStopLoss: 30,
  maxOpenPositions: 3,
  slippageTolerance: 5,
};

/* ------------------------------------------------------------------ */
/*  Mock token discovery (replaced by backend scanner)                 */
/* ------------------------------------------------------------------ */

const MOCK_NAMES = ['PepeCat', 'SolDoge', 'LunarAI', 'NeonSwap', 'ZeroPhi', 'ChainPulse', 'FastYield', 'MoonFi'];

function randomToken(chain: SupportedChain): TokenCandidate {
  const idx = Math.floor(Math.random() * MOCK_NAMES.length);
  const name = MOCK_NAMES[idx];
  const symbol = name.slice(0, 4).toUpperCase();
  const creatorWinRate = Math.floor(Math.random() * 60 + 40);
  return {
    id: crypto.randomUUID(),
    name,
    symbol,
    chain,
    contractAddress: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    creatorAddress: '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    creatorWinRate,
    liquidityUsd: Math.floor(Math.random() * 50000 + 2000),
    marketCapUsd: Math.floor(Math.random() * 200000 + 5000),
    ageMinutes: Math.floor(Math.random() * 120 + 1),
    riskScore: Math.floor(Math.random() * 80 + 5),
    signalStrength: Math.floor(Math.random() * 60 + 35),
    holders: Math.floor(Math.random() * 500 + 10),
    buyTax: Math.floor(Math.random() * 10),
    sellTax: Math.floor(Math.random() * 12),
    isHoneypot: Math.random() < 0.08,
    status: 'pending',
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AutomatedTrading({
  isWalletConnected,
  walletAddress,
  onRequestWalletConnect,
}: AutomatedTradingProps) {
  const [config, setConfig] = useState<AutoTradeConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<TokenCandidate[]>([]);
  const [configOpen, setConfigOpen] = useState(true);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Patch config helper */
  const patch = useCallback(
    <K extends keyof AutoTradeConfig>(key: K, value: AutoTradeConfig[K]) =>
      setConfig((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /* Scanner loop */
  useEffect(() => {
    if (!running) {
      if (scanRef.current) clearInterval(scanRef.current);
      scanRef.current = null;
      return;
    }

    const scan = () => {
      const token = randomToken(config.chain);
      setCandidates((prev) => {
        // Evaluate token against config
        const passesFilter =
          token.creatorWinRate >= config.minCreatorWinRate &&
          token.riskScore <= config.maxRiskScore &&
          token.liquidityUsd >= config.minLiquidityUsd &&
          token.signalStrength >= config.minSignalStrength &&
          !token.isHoneypot;

        const openPositions = prev.filter((t) => t.status === 'bought').length;

        if (passesFilter && openPositions < config.maxOpenPositions) {
          token.status = 'bought';
          toast.success(`Auto-bought ${token.symbol}`, {
            description: `${token.chain} · Creator WR ${token.creatorWinRate}% · Signal ${token.signalStrength}%`,
          });
        } else if (token.isHoneypot) {
          token.status = 'skipped';
        } else if (!passesFilter) {
          token.status = 'skipped';
        }

        return [token, ...prev].slice(0, 50); // Keep last 50
      });
    };

    scan(); // immediate first tick
    scanRef.current = setInterval(scan, 4000);
    return () => {
      if (scanRef.current) clearInterval(scanRef.current);
    };
  }, [running, config]);

  /* PnL simulation for bought tokens */
  useEffect(() => {
    if (!running) return;
    const pnlInterval = setInterval(() => {
      setCandidates((prev) =>
        prev.map((t) => {
          if (t.status !== 'bought') return t;
          const pnl = (t.pnlPercent ?? 0) + (Math.random() - 0.45) * 8;

          if (pnl >= config.autoTakeProfit) {
            toast.success(`Take-profit hit on ${t.symbol}`, {
              description: `+${pnl.toFixed(1)}% profit secured`,
            });
            return { ...t, pnlPercent: pnl, status: 'sold' as const };
          }
          if (pnl <= -config.autoStopLoss) {
            toast.error(`Stop-loss hit on ${t.symbol}`, {
              description: `${pnl.toFixed(1)}% — position closed`,
            });
            return { ...t, pnlPercent: pnl, status: 'sold' as const };
          }
          return { ...t, pnlPercent: pnl };
        }),
      );
    }, 3000);
    return () => clearInterval(pnlInterval);
  }, [running, config.autoTakeProfit, config.autoStopLoss]);

  const toggleBot = () => {
    if (!isWalletConnected) {
      toast.error('Connect your wallet first');
      onRequestWalletConnect();
      return;
    }
    setRunning((r) => !r);
    toast.info(running ? 'Automated trading paused' : 'Automated trading started');
  };

  const openPositions = candidates.filter((t) => t.status === 'bought');
  const totalPnl = openPositions.reduce((s, t) => s + (t.pnlPercent ?? 0), 0);

  /* -------------------------------------------------------------- */
  /*  Main UI                                                        */
  /* -------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* ── Wallet banner ─────────────────────────────────────────── */}
      {!isWalletConnected && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-zinc-900/80 border border-zinc-800/60 rounded-xl">
          <p className="text-zinc-400 text-sm">
            Connect your wallet to start the auto-trader and execute trades.
          </p>
          <button
            onClick={onRequestWalletConnect}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium shrink-0"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Auto-Trader</h3>
              <p className="text-xs text-zinc-500">
                {walletAddress
                  ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
                  : 'No wallet connected'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {running && (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Scanning
              </span>
            )}
            <button
              onClick={toggleBot}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                running
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {running ? (
                <>
                  <Pause className="w-4 h-4" /> Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> Start Bot
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Open positions" value={String(openPositions.length)} />
          <Stat
            label="Unrealised P&L"
            value={`${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%`}
            color={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <Stat label="Scanned" value={String(candidates.length)} />
          <Stat label="Chain" value={CHAIN_META[config.chain].label} />
        </div>
      </div>

      {/* Config panel */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
        <button
          onClick={() => setConfigOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-zinc-300 hover:text-white transition-colors"
        >
          <span>Strategy Configuration</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${configOpen ? 'rotate-180' : ''}`} />
        </button>

        {configOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-zinc-800 pt-4">
            {/* Chain selector */}
            <div>
              <label className="text-xs text-zinc-400 block mb-2">Target Chain</label>
              <div className="flex gap-2 flex-wrap">
                {CHAINS.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch('chain', c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      config.chain === c
                        ? `${CHAIN_META[c].color} text-white`
                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {CHAIN_META[c].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ConfigInput label="Max buy (USD)" value={config.maxBuyAmountUsd} onChange={(v) => patch('maxBuyAmountUsd', v)} />
              <ConfigInput label="Min creator WR %" value={config.minCreatorWinRate} onChange={(v) => patch('minCreatorWinRate', v)} />
              <ConfigInput label="Max risk score" value={config.maxRiskScore} onChange={(v) => patch('maxRiskScore', v)} />
              <ConfigInput label="Min liquidity (USD)" value={config.minLiquidityUsd} onChange={(v) => patch('minLiquidityUsd', v)} />
              <ConfigInput label="Min signal strength %" value={config.minSignalStrength} onChange={(v) => patch('minSignalStrength', v)} />
              <ConfigInput label="Auto take-profit %" value={config.autoTakeProfit} onChange={(v) => patch('autoTakeProfit', v)} />
              <ConfigInput label="Auto stop-loss %" value={config.autoStopLoss} onChange={(v) => patch('autoStopLoss', v)} />
              <ConfigInput label="Max open positions" value={config.maxOpenPositions} onChange={(v) => patch('maxOpenPositions', v)} />
              <ConfigInput label="Slippage tolerance %" value={config.slippageTolerance} onChange={(v) => patch('slippageTolerance', v)} />
            </div>
          </div>
        )}
      </div>

      {/* Token feed */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Search className="w-4 h-4" />
          Token Scanner Feed
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 ml-auto" />}
        </h4>

        {candidates.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-6">
            {running ? 'Scanning for new tokens…' : 'Start the bot to begin scanning.'}
          </p>
        ) : (
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
            {candidates.map((token) => (
              <TokenRow key={token.id} token={token} chain={config.chain} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold ${color} tabular-nums`}>{value}</p>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-zinc-800/60 text-white px-3 py-2 rounded-lg border border-zinc-700/50 focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/20 text-sm tabular-nums transition-colors"
      />
    </div>
  );
}

function TokenRow({ token, chain }: { token: TokenCandidate; chain: SupportedChain }) {
  const meta = CHAIN_META[chain];

  const statusBadge = (() => {
    switch (token.status) {
      case 'bought':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">BOUGHT</span>;
      case 'sold':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">SOLD</span>;
      case 'skipped':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-400 font-medium">SKIP</span>;
      case 'failed':
        return <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">FAIL</span>;
      default:
        return <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-500 font-medium">PENDING</span>;
    }
  })();

  return (
    <div className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2.5 text-sm">
      {/* Left: Name + chain badge */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-7 h-7 rounded-md ${meta.color} flex items-center justify-center flex-shrink-0`}>
          <span className="text-[10px] text-white font-bold">{token.symbol.slice(0, 2)}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white font-medium truncate">{token.name}</span>
            <span className="text-zinc-500 text-xs">{token.symbol}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
            <span>{token.ageMinutes}m ago</span>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <ShieldCheck className="w-3 h-3" />
              WR {token.creatorWinRate}%
            </span>
            <span>·</span>
            <span>Sig {token.signalStrength}%</span>
            {token.isHoneypot && (
              <span className="text-red-400 flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" /> HP
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: PnL + status */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {token.pnlPercent !== undefined && (
          <span
            className={`text-xs font-semibold tabular-nums ${
              token.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {token.pnlPercent >= 0 ? '+' : ''}
            {token.pnlPercent.toFixed(1)}%
          </span>
        )}
        {statusBadge}
        <a
          href={`${meta.explorer}${token.contractAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
