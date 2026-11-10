import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthProvider } from './contexts/AuthProvider';
import { PaperProvider } from './contexts/PaperProvider';
import { Toaster } from './components/ui/sonner';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Homepage } from './components/Homepage';
import { WaitlistModal } from './components/WaitlistModal';
import { WalletConnectionModal } from './components/WalletConnectionModal';
import { EmailAuthModal } from './components/EmailAuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/ui/common';
import { useHashView, type ViewId } from './hooks/useHashView';
import { BACKEND_CONFIGURED } from './services/api';

const DashboardView = lazy(() => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })));
const TradingTerminal = lazy(() => import('./components/TradingTerminal').then((m) => ({ default: m.TradingTerminal })));
const SniperPanel = lazy(() => import('./components/SniperPanel').then((m) => ({ default: m.SniperPanel })));
const TradeBook = lazy(() => import('./components/TradeBook').then((m) => ({ default: m.TradeBook })));
const WhaleAlert = lazy(() => import('./components/WhaleAlert').then((m) => ({ default: m.WhaleAlert })));
const FundamentalNews = lazy(() => import('./components/FundamentalNews').then((m) => ({ default: m.FundamentalNews })));
const StocksPreIPO = lazy(() => import('./components/StocksPreIPO').then((m) => ({ default: m.StocksPreIPO })));
const AIChat = lazy(() => import('./components/AIChat').then((m) => ({ default: m.AIChat })));
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));

const TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  trading: 'Trading Terminal',
  sniper: 'Sniper Engine',
  tradebook: 'Trade Book',
  whale: 'Whale Alerts',
  news: 'Fundamental News',
  stocks: 'Stocks & PRE-IPO',
  chat: 'AI Chat',
  settings: 'Settings',
};

// Set VITE_APP_WAITLIST_GATE=true to keep the app closed and send visitors to the waitlist.
const WAITLIST_GATE = import.meta.env.VITE_APP_WAITLIST_GATE === 'true' && !import.meta.env.DEV;

function Shell() {
  const { view, navigate } = useHashView();
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const launch = useCallback(() => {
    if (WAITLIST_GATE) {
      setWaitlistOpen(true);
      toast.info('Arctos is in early access. Join the waitlist to be invited.');
      return;
    }
    navigate('dashboard');
  }, [navigate]);

  // Gated deployments cannot be opened by typing a URL hash either.
  useEffect(() => {
    if (WAITLIST_GATE && view) navigate(null);
  }, [view, navigate]);

  useEffect(() => {
    document.title = view ? `${TITLES[view]} | Arctos` : 'Arctos | Live crypto trading intelligence';
  }, [view]);

  if (!view || WAITLIST_GATE) {
    return (
      <>
        <Homepage onLaunch={launch} onOpenWaitlist={() => setWaitlistOpen(true)} onOpenWallet={() => setWalletOpen(true)} />
        <WaitlistModal isOpen={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
        <WalletConnectionModal open={walletOpen} onOpenChange={setWalletOpen} />
      </>
    );
  }

  const render = () => {
    switch (view) {
      case 'dashboard': return <DashboardView onNavigate={navigate} onConnectWallet={() => setWalletOpen(true)} />;
      case 'trading': return <TradingTerminal />;
      case 'sniper': return <SniperPanel />;
      case 'tradebook': return <TradeBook />;
      case 'whale': return <WhaleAlert />;
      case 'news': return <FundamentalNews />;
      case 'stocks': return <StocksPreIPO />;
      case 'chat': return <AIChat />;
      case 'settings': return <Settings onConnectWallet={() => setWalletOpen(true)} />;
    }
  };

  return (
    <div className="h-screen flex bg-black text-zinc-100 overflow-hidden">
      <Sidebar active={view} onNavigate={navigate} open={menuOpen} onClose={closeMenu} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={TITLES[view]} onMenu={() => setMenuOpen(true)} onConnectWallet={() => setWalletOpen(true)} onSignIn={() => setEmailOpen(true)} />
        {!BACKEND_CONFIGURED && (
          <div role="alert" className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-sm px-4 py-2">
            The Arctos data service URL is not configured, so live data cannot load. Set VITE_RUST_BACKEND_URL when building the site.
          </div>
        )}
        <main className="flex-1 overflow-auto" id="main">
          <ErrorBoundary resetKey={view}>
            <Suspense fallback={<Loading label="Opening" />}>{render()}</Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <WalletConnectionModal open={walletOpen} onOpenChange={setWalletOpen} />
      <EmailAuthModal open={emailOpen} onOpenChange={setEmailOpen} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PaperProvider>
        <Shell />
        <Toaster theme="dark" />
      </PaperProvider>
    </AuthProvider>
  );
}
