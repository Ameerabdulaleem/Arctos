import { useEffect, useMemo, useState } from 'react';
import {
  Zap,
  Play,
  Pause,
  Settings,
  Plus,
  Target,
  Clock,
  Search,
  Loader2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { WalletConnectionModal } from './WalletConnectionModal';
import {
  sniperService,
  type SniperToken,
  type SniperConfig,
  type SupportedChain,
  type SniperExecution,
} from '../services/sniperService';

const CHAINS: { value: SupportedChain; label: string }[] = [
  { value: 'solana', label: 'Solana' },
  { value: 'bnb', label: 'BNB Chain' },
  { value: 'base', label: 'Base' },
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'arbitrum', label: 'Arbitrum' },
  { value: 'other', label: 'Other' },
];

export function SniperPanel() {
  const { isWalletConnected, user } = useAuth();

  const [isActive, setIsActive] = useState(false);
  const [tokens, setTokens] = useState<SniperToken[]>([]);
  const [recentSnipes, setRecentSnipes] = useState<SniperExecution[]>([]);
  const [selectedToken, setSelectedToken] = useState<SniperToken | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [searchChain, setSearchChain] = useState<SupportedChain>('solana');
  const [isSearching, setIsSearching] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [isSnipingNow, setIsSnipingNow] = useState<string | null>(null);

  const [config, setConfig] = useState<SniperConfig>(sniperService.getDefaultConfig());

  useEffect(() => {
    let mounted = true;

    const loadTokens = async () => {
      const list = await sniperService.getTrackedTokens();
      if (mounted) {
        setTokens(list);
      }
    };

    void loadTokens();

    const unsubscribe = sniperService.subscribeToUpdates((event) => {
      if (event.type === 'token_update' && event.token) {
        setTokens((previous) =>
          previous.map((token) => (token.id === event.token?.id ? { ...token, ...event.token } : token)),
        );
      }

      if (event.type === 'execution' && event.execution) {
        const execution = event.execution;
        setRecentSnipes((previous) => [execution, ...previous].slice(0, 20));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const activeSnipes = useMemo(() => tokens.filter((token) => token.status === 'active').length, [tokens]);

  const successRate = useMemo(() => {
    if (!recentSnipes.length) return 0;
    const successCount = recentSnipes.filter((entry) => entry.success).length;
    return (successCount / recentSnipes.length) * 100;
  }, [recentSnipes]);

  const setConfigValue = <K extends keyof SniperConfig>(key: K, value: SniperConfig[K]) => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  };

  const handleAddToken = async () => {
    const query = searchInput.trim();
    if (!query) {
      toast.error('Enter token name or contract address');
      return;
    }

    setIsSearching(true);
    try {
      const token = await sniperService.searchToken(query, searchChain);
      if (!token) {
        toast.error('Token not found on selected chain');
        return;
      }

      setTokens((previous) => {
        const exists = previous.some((item) => item.address.toLowerCase() === token.address.toLowerCase());
        if (exists) return previous;
        return [token, ...previous];
      });

      setSearchInput('');
      toast.success(`Added ${token.symbol} (${sniperService.formatChain(token.chain)}) to tracked tokens`);
    } catch {
      toast.error('Unable to fetch token now. Try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSaveConfiguration = async () => {
    setIsSavingConfig(true);
    try {
      const saved = await sniperService.saveConfig(config);
      if (!saved) {
        toast.error('Configuration save failed on backend');
        return;
      }
      toast.success('Configuration saved');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleToggleBot = async () => {
    if (!isWalletConnected) {
      toast.error('Connect wallet before enabling sniper bot');
      setWalletModalOpen(true);
      return;
    }

    const nextState = !isActive;
    setIsTogglingBot(true);

    try {
      const ok = await sniperService.setBotState(nextState, user?.walletAddress);
      if (!ok) {
        toast.error('Could not update bot status on backend');
        return;
      }

      setIsActive(nextState);
      toast.success(nextState ? 'Sniper bot activated' : 'Sniper bot paused');
    } finally {
      setIsTogglingBot(false);
    }
  };

  const handleSnipe = async (token: SniperToken) => {
    if (!isWalletConnected) {
      toast.error('Connect wallet before sniping');
      setWalletModalOpen(true);
      return;
    }

    setSelectedToken(token);
    setIsSnipingNow(token.id);

    try {
      const execution = await sniperService.snipeNow(token, user?.walletAddress);
      if (!execution) {
        toast.error('Snipe request failed');
        return;
      }

      setRecentSnipes((previous) => [execution, ...previous].slice(0, 20));
      setTokens((previous) =>
        previous.map((item) => (item.id === token.id ? { ...item, status: 'triggered' } : item)),
      );

      if (execution.success) {
        toast.success(`Snipe executed for ${token.symbol}`);
      } else {
        toast.error(`Snipe failed for ${token.symbol}`);
      }
    } finally {
      setIsSnipingNow(null);
    }
  };

  return (
    <div className="h-full bg-black p-6 overflow-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3 tracking-tight">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center shadow-lg shadow-yellow-600/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            Sniper Engine
          </h1>
          <div className="flex items-center gap-3">
            {isActive && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-xs text-green-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Scanning
              </span>
            )}
            <button
              onClick={handleToggleBot}
              disabled={isTogglingBot}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-lg ${
                isActive
                  ? 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/20'
                  : !isWalletConnected
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shadow-none border border-zinc-700'
              }`}
            >
              {isTogglingBot ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isActive ? (
                <Pause className="w-4 h-4" />
              ) : !isWalletConnected ? (
                <Plus className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isActive ? 'Active' : !isWalletConnected ? 'Connect Wallet' : 'Start Bot'}
            </button>
          </div>
        </div>
        <p className="text-zinc-500 text-sm">Cross-chain sniper engine with configurable filters and wallet-gated execution.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 tracking-tight">
              <Settings className="w-4 h-4 text-zinc-400" />
              Configuration
            </h2>
          </div>

          <div className="space-y-4">
            <ConfigField
              label="Min Liquidity ($K)"
              help="Minimum pool liquidity allowed before bot can buy. Helps avoid illiquid traps."
              value={config.minLiquidityUsdK}
              onChange={(value) => setConfigValue('minLiquidityUsdK', value)}
            />
            <ConfigField
              label="Max Buy Tax (%)"
              help="Reject tokens if buy tax is above this percent."
              value={config.maxBuyTaxPercent}
              onChange={(value) => setConfigValue('maxBuyTaxPercent', value)}
            />
            <ConfigField
              label="Max Sell Tax (%)"
              help="Reject tokens if sell tax is above this percent."
              value={config.maxSellTaxPercent}
              onChange={(value) => setConfigValue('maxSellTaxPercent', value)}
            />
            <ConfigField
              label="Gas Price (Gwei)"
              help="Priority fee for EVM chains; higher means faster inclusion."
              value={config.gasPriceGwei}
              onChange={(value) => setConfigValue('gasPriceGwei', value)}
            />
            <ConfigField
              label="Slippage (%)"
              help="Max allowed execution slippage before transaction is canceled."
              value={config.slippagePercent}
              onChange={(value) => setConfigValue('slippagePercent', value)}
            />
            <ConfigField
              label="Max Position ($)"
              help="Maximum USD amount to spend for one snipe."
              value={config.maxPositionUsd}
              onChange={(value) => setConfigValue('maxPositionUsd', value)}
            />
            <ConfigField
              label="Min Creator Win Rate (%)"
              help="Minimum historical creator success rate required to allow buy."
              value={config.minCreatorWinRate}
              onChange={(value) => setConfigValue('minCreatorWinRate', value)}
            />
            <ConfigField
              label="Max Risk Score"
              help="Upper risk score threshold from your backend token-risk engine."
              value={config.maxRiskScore}
              onChange={(value) => setConfigValue('maxRiskScore', value)}
            />
            <ConfigField
              label="Auto Take Profit (%)"
              help="Automatically close profitable position at this gain."
              value={config.autoTakeProfitPercent}
              onChange={(value) => setConfigValue('autoTakeProfitPercent', value)}
            />
            <ConfigField
              label="Auto Stop Loss (%)"
              help="Automatically close losing position at this drawdown."
              value={config.autoStopLossPercent}
              onChange={(value) => setConfigValue('autoStopLossPercent', value)}
            />

            <button
              onClick={handleSaveConfiguration}
              disabled={isSavingConfig}
              className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium disabled:opacity-70 shadow-lg shadow-blue-600/10 text-sm"
            >
              {isSavingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-zinc-800">
            <h3 className="text-white font-medium mb-3">Quick Stats</h3>
            <div className="space-y-2 text-sm">
              <StatRow label="Tokens Tracked" value={`${tokens.length}`} />
              <StatRow label="Active Snipes" value={`${activeSnipes}`} valueClass="text-green-500" />
              <StatRow label="Success Rate" value={`${successRate.toFixed(1)}%`} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white tracking-tight">Tracked Tokens</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={searchChain}
                onChange={(event) => setSearchChain(event.target.value as SupportedChain)}
                className="bg-zinc-800 text-zinc-200 px-3 py-2 rounded-lg border border-zinc-700 text-sm"
              >
                {CHAINS.map((chain) => (
                  <option key={chain.value} value={chain.value}>
                    {chain.label}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Token symbol, name, or address"
                  className="bg-zinc-800 text-zinc-100 pl-9 pr-3 py-2 rounded-lg border border-zinc-700 text-sm min-w-[220px]"
                />
              </div>
              <button
                onClick={handleAddToken}
                disabled={isSearching}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-70"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Token
              </button>
            </div>
          </div>

          <p className="text-zinc-500 text-xs mb-5 flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            Token search is backend-ready: when Rust token indexers are connected, newly created tokens are returned instantly.
          </p>

          <div className="space-y-3">
            {tokens.map((token) => {
              // Compute risk score based on config thresholds
              const liquidityOk = token.liquidityUsd >= config.minLiquidityUsdK * 1000;
              const holdersOk = token.holders >= 100;
              const riskFactors = [!liquidityOk && 'Low liquidity', !holdersOk && 'Few holders'].filter(Boolean) as string[];
              const riskLevel = riskFactors.length === 0 ? 'low' : riskFactors.length === 1 ? 'medium' : 'high';

              return (
                <div
                  key={token.id}
                  className="p-5 bg-zinc-800/40 rounded-xl border border-zinc-700/50 hover:border-zinc-600/70 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <h3 className="text-white font-bold text-lg">{token.symbol}</h3>
                        <StatusBadge status={token.status} />
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 uppercase tracking-wider font-medium">
                          {sniperService.formatChain(token.chain)}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          riskLevel === 'low' ? 'bg-green-500/15 text-green-400 border border-green-500/20' :
                          riskLevel === 'medium' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' :
                          'bg-red-500/15 text-red-400 border border-red-500/20'
                        }`}>
                          {riskLevel === 'low' ? 'Safe' : riskLevel === 'medium' ? 'Caution' : 'High Risk'}
                        </span>
                      </div>
                      <p className="text-zinc-400 text-sm">{token.name}</p>
                      <p className="text-zinc-600 text-xs mt-1 font-mono">
                        {token.address.slice(0, 10)}...{token.address.slice(-8)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold text-lg tabular-nums">{sniperService.formatCurrency(token.price)}</p>
                      <p className={`text-sm font-medium tabular-nums ${token.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {token.change24h >= 0 ? '+' : ''}
                        {token.change24h.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  {riskFactors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {riskFactors.map((factor) => (
                        <span key={factor} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/15">
                          {factor}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <Metric label="Liquidity" value={sniperService.formatCompactCurrency(token.liquidityUsd)} />
                    <Metric label="Market Cap" value={sniperService.formatCompactCurrency(token.marketCapUsd)} />
                    <Metric label="Holders" value={token.holders.toLocaleString()} />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSnipe(token)}
                      disabled={isSnipingNow === token.id}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-70 shadow-lg shadow-green-600/10"
                    >
                      {isSnipingNow === token.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Target className="w-4 h-4" />
                      )}
                      Snipe Now
                    </button>
                    <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-700/50 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors text-sm border border-zinc-700/50">
                      <Clock className="w-4 h-4" />
                    </button>
                    <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-700/50 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors text-sm border border-zinc-700/50">
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 pt-6 border-t border-zinc-800/60">
            <h3 className="text-white font-semibold mb-4 tracking-tight">Recent Snipes</h3>
            <div className="space-y-2">
              {recentSnipes.length === 0 ? (
                <div className="text-zinc-500 text-sm py-6 text-center">No snipes executed yet.</div>
              ) : (
                recentSnipes.slice(0, 8).map((snipe, index) => (
                  <div key={`${snipe.token}-${index}`} className="flex items-center justify-between p-3 bg-zinc-800/40 rounded-lg text-sm border border-zinc-700/30 hover:border-zinc-700/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${snipe.success ? 'bg-green-400 shadow-sm shadow-green-400/50' : 'bg-red-400 shadow-sm shadow-red-400/50'}`} />
                      <span className="text-white font-medium">{snipe.token}</span>
                      <span className="text-zinc-400">{snipe.action}</span>
                      <span className="text-zinc-500 tabular-nums">{snipe.amount}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium tabular-nums">{sniperService.formatCurrency(snipe.valueUsd)}</span>
                      <span className="text-zinc-500 text-xs">{snipe.time}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedToken && (
        <p className="mt-4 text-xs text-zinc-500">
          Last selected token: <span className="text-zinc-300">{selectedToken.symbol}</span>
        </p>
      )}

      <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
    </div>
  );
}

function ConfigField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="text-zinc-300 text-xs font-medium mb-1.5 block tracking-wide uppercase">{label}</label>
      <p className="text-[11px] text-zinc-500 mb-2 leading-relaxed">{help}</p>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-zinc-800/60 text-white px-3.5 py-2.5 rounded-lg border border-zinc-700/50 focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/20 text-sm tabular-nums transition-colors"
      />
    </div>
  );
}

function StatusBadge({ status }: { status: SniperToken['status'] }) {
  const styles =
    status === 'active'
      ? 'bg-green-500/15 text-green-400 border border-green-500/20'
      : status === 'paused'
      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
      : 'bg-blue-500/15 text-blue-400 border border-blue-500/20';

  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${styles}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/30 rounded-lg px-3 py-2">
      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-white text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatRow({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className={`font-semibold text-sm tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
