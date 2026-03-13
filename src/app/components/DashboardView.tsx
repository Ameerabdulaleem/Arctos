import { useEffect, useMemo, useState } from 'react';
import { Bell, TrendingUp, ArrowUpRight, ArrowDownRight, Clock, RefreshCw, Wallet, User, LogOut } from 'lucide-react';
import { PortfolioValueWidget, AltseasonIndexWidget, DominanceWidget, MarketCapWidget, FearGreedWidget } from './PortfolioWidgets';
import { AssetTabs } from './AssetTabs';
import { DashboardSnapshot, dashboardSyncService } from '../services/dashboardSyncService';
import { WalletConnectionModal } from './WalletConnectionModal';
import { EmailAuthModal } from './EmailAuthModal';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

export function DashboardView() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncMode, setSyncMode] = useState<'live' | 'fallback'>('fallback');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [emailAuthModalOpen, setEmailAuthModalOpen] = useState(false);
  const { isAuthenticated, isWalletConnected, disconnectWallet, signOut } = useAuth();

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const initial = await dashboardSyncService.getInitialSnapshot();
      if (isMounted) {
        setSnapshot(initial);
        setIsSyncing(false);
      }
    };

    void load();

    const unsubscribe = dashboardSyncService.subscribeToUpdates((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setSyncMode('live');
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const recentActivities = useMemo(() => snapshot?.recentActivities ?? [], [snapshot]);

  const handleSignOut = () => {
    signOut();
    toast.success('Signed out successfully');
  };

  const handleDisconnectWallet = () => {
    disconnectWallet();
    toast.success('Wallet disconnected');
  };

  if (!snapshot) {
    return (
      <div className="p-6 bg-black min-h-full flex items-center justify-center">
        <div className="text-zinc-400 inline-flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-black min-h-full">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-3 text-sm mt-1">
            <p className="text-zinc-500">Portfolio overview &amp; market pulse</p>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${syncMode === 'live' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${syncMode === 'live' ? 'bg-emerald-400' : 'bg-amber-400'} ${isSyncing ? 'animate-pulse' : ''}`} />
              {syncMode === 'live' ? 'Live sync' : 'Fallback'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isAuthenticated ? (
            <>
              <button
                onClick={() => setWalletModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors shadow-lg shadow-blue-600/20"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
              <button
                onClick={() => setEmailAuthModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors"
              >
                <User className="w-4 h-4" />
                Sign In
              </button>
            </>
          ) : (
            <button
              onClick={isWalletConnected ? handleDisconnectWallet : handleSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {isWalletConnected ? 'Disconnect' : 'Sign Out'}
            </button>
          )}

          <button className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 transition-colors relative">
            <Bell className="w-4 h-4 text-zinc-300" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <PortfolioValueWidget metrics={snapshot.metrics} />
        <AltseasonIndexWidget metrics={snapshot.metrics} />
        <DominanceWidget metrics={snapshot.metrics} />
        <MarketCapWidget metrics={snapshot.metrics} />
        <FearGreedWidget metrics={snapshot.metrics} />
      </div>

      <AssetTabs assets={snapshot.assets} />

      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white text-lg font-semibold tracking-tight">Recent Activity</h2>
          <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15">View All</button>
        </div>

        <div className="space-y-2">
          {recentActivities.map((activity, index) => (
            <div key={`${activity.chain}-${activity.action}-${index}`} className="flex items-center justify-between p-3.5 bg-zinc-800/50 rounded-lg hover:bg-zinc-800/80 transition-colors border border-transparent hover:border-zinc-700/50">
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 ${
                    activity.type === 'buy'
                      ? 'bg-green-600/20 text-green-400'
                      : activity.type === 'sell'
                        ? 'bg-red-600/20 text-red-400'
                        : activity.type === 'stake'
                          ? 'bg-purple-600/20 text-purple-400'
                          : activity.type === 'swap'
                            ? 'bg-blue-600/20 text-blue-400'
                            : activity.type === 'receive'
                              ? 'bg-cyan-600/20 text-cyan-400'
                              : 'bg-orange-600/20 text-orange-400'
                  } rounded-lg flex items-center justify-center`}
                >
                  {activity.type === 'buy' && <ArrowDownRight className="w-4 h-4" />}
                  {activity.type === 'sell' && <ArrowUpRight className="w-4 h-4" />}
                  {activity.type === 'stake' && <TrendingUp className="w-4 h-4" />}
                  {activity.type === 'swap' && <TrendingUp className="w-4 h-4 rotate-90" />}
                  {activity.type === 'receive' && <ArrowDownRight className="w-4 h-4" />}
                  {activity.type === 'claim' && <TrendingUp className="w-4 h-4" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-medium">{activity.action}</p>
                    <span className={`${activity.chainColor} text-white text-[10px] px-1.5 py-0.5 rounded font-medium`}>{activity.chain}</span>
                  </div>
                  <p className="text-zinc-500 text-xs mt-0.5">{activity.amount}</p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-white text-sm font-medium tabular-nums">{activity.value}</p>
                <div className="flex items-center gap-1 text-zinc-500 text-xs justify-end mt-0.5">
                  <Clock className="w-3 h-3" />
                  {activity.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
      <EmailAuthModal open={emailAuthModalOpen} onOpenChange={setEmailAuthModalOpen} />
    </div>
  );
}