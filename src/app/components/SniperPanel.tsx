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
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Zap className="w-8 h-8 text-yellow-500" />
            Sniper Engine
          </h1>
          <button
            onClick={handleToggleBot}
            disabled={isTogglingBot}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors ${
              isActive
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : !isWalletConnected
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            {isTogglingBot ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isActive ? (
              <Pause className="w-5 h-5" />
            ) : !isWalletConnected ? (
              <Plus className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            {isActive ? 'Active' : !isWalletConnected ? 'Connect Wallet' : 'Inactive'}
          </button>
        </div>
        <p className="text-zinc-400">Cross-chain sniper engine with configurable filters and wallet-gated execution.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
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
              className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-70"
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

        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-white">Tracked Tokens</h2>
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
            {tokens.map((token) => (
              <div
                key={token.id}
                className="p-5 bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-bold text-lg">{token.symbol}</h3>
                      <StatusBadge status={token.status} />
                      <span className="text-[11px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 uppercase tracking-wide">
                        {sniperService.formatChain(token.chain)}
                      </span>
                    </div>
                    <p className="text-zinc-400 text-sm">{token.name}</p>
                    <p className="text-zinc-500 text-xs mt-1 font-mono">
                      {token.address.slice(0, 10)}...{token.address.slice(-8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold text-lg">{sniperService.formatCurrency(token.price)}</p>
                    <p className={`text-sm ${token.change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {token.change24h >= 0 ? '+' : ''}
                      {token.change24h.toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <Metric label="Liquidity" value={sniperService.formatCompactCurrency(token.liquidityUsd)} />
                  <Metric label="Market Cap" value={sniperService.formatCompactCurrency(token.marketCapUsd)} />
                  <Metric label="Holders" value={token.holders.toLocaleString()} />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleSnipe(token)}
                    disabled={isSnipingNow === token.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-70"
                  >
                    {isSnipingNow === token.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Target className="w-4 h-4" />
                    )}
                    Snipe Now
                  </button>
                  <button className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-700 text-white rounded-lg hover:bg-zinc-600 transition-colors text-sm">
                    <Clock className="w-4 h-4" />
                  </button>
                  <button className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-700 text-white rounded-lg hover:bg-zinc-600 transition-colors text-sm">
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-zinc-800">
            <h3 className="text-white font-bold mb-4">Recent Snipes</h3>
            <div className="space-y-2">
              {recentSnipes.length === 0 ? (
                <div className="text-zinc-500 text-sm">No snipes yet.</div>
              ) : (
                recentSnipes.slice(0, 8).map((snipe, index) => (
                  <div key={`${snipe.token}-${index}`} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg text-sm">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${snipe.success ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-white font-medium">{snipe.token}</span>
                      <span className="text-zinc-400">{snipe.action}</span>
                      <span className="text-zinc-500">{snipe.amount}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white font-medium">{sniperService.formatCurrency(snipe.valueUsd)}</span>
                      <span className="text-zinc-500">{snipe.time}</span>
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
      <label className="text-zinc-200 text-sm mb-2 block">{label}</label>
      <p className="text-xs text-zinc-500 mb-2">{help}</p>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-zinc-800 text-white px-4 py-3 rounded-lg border border-zinc-700 focus:border-blue-600 focus:outline-none"
      />
    </div>
  );
}

function StatusBadge({ status }: { status: SniperToken['status'] }) {
  const styles =
    status === 'active'
      ? 'bg-green-500/20 text-green-500'
      : status === 'paused'
      ? 'bg-yellow-500/20 text-yellow-500'
      : 'bg-blue-500/20 text-blue-500';

  return <span className={`px-2 py-1 rounded text-xs font-medium ${styles}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className="text-white text-sm font-medium">{value}</p>
    </div>
  );
}

function StatRow({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
