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
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <div className="flex items-center gap-3 text-sm">
            <p className="text-zinc-400">Welcome back! Here&apos;s your portfolio overview</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${syncMode === 'live' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-400 border-amber-500/40 bg-amber-500/10'}`}>
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {syncMode === 'live' ? 'Rust live sync' : 'Fallback sync'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isAuthenticated ? (
            <>
              <button
                onClick={() => setWalletModalOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
              <button
                onClick={() => setEmailAuthModalOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors"
              >
                <User className="w-4 h-4" />
                Sign In
              </button>
            </>
          ) : (
            <button
              onClick={isWalletConnected ? handleDisconnectWallet : handleSignOut}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {isWalletConnected ? 'Disconnect Wallet' : 'Sign Out'}
            </button>
          )}

          <button className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 transition-colors relative">
            <Bell className="w-5 h-5 text-white" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl font-bold">Recent Activity</h2>
          <button className="text-sm text-blue-500 hover:text-blue-400 transition-colors">View All</button>
        </div>

        <div className="space-y-3">
          {recentActivities.map((activity, index) => (
            <div key={`${activity.chain}-${activity.action}-${index}`} className="flex items-center justify-between p-4 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors group">
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 ${
                    activity.type === 'buy'
                      ? 'bg-green-600'
                      : activity.type === 'sell'
                        ? 'bg-red-600'
                        : activity.type === 'stake'
                          ? 'bg-purple-600'
                          : activity.type === 'swap'
                            ? 'bg-blue-600'
                            : activity.type === 'receive'
                              ? 'bg-cyan-600'
                              : 'bg-orange-600'
                  } rounded-full flex items-center justify-center`}
                >
                  {activity.type === 'buy' && <ArrowDownRight className="w-5 h-5 text-white" />}
                  {activity.type === 'sell' && <ArrowUpRight className="w-5 h-5 text-white" />}
                  {activity.type === 'stake' && <TrendingUp className="w-5 h-5 text-white" />}
                  {activity.type === 'swap' && <TrendingUp className="w-5 h-5 text-white rotate-90" />}
                  {activity.type === 'receive' && <ArrowDownRight className="w-5 h-5 text-white" />}
                  {activity.type === 'claim' && <TrendingUp className="w-5 h-5 text-white" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium">{activity.action}</p>
                    <span className={`${activity.chainColor} text-white text-xs px-2 py-0.5 rounded`}>{activity.chain}</span>
                  </div>
                  <p className="text-zinc-400 text-sm">{activity.amount}</p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-white font-medium">{activity.value}</p>
                <div className="flex items-center gap-1 text-zinc-400 text-sm justify-end">
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