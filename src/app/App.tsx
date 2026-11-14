import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
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

function Shell() {
  const { view, navigate } = useHashView();
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // "Get started" always gives access. No sign in, wallet or waitlist is needed to use the app.
  const launch = useCallback((target: ViewId = 'dashboard') => navigate(target), [navigate]);

  useEffect(() => {
    document.title = view ? `${TITLES[view]} | Arctos` : 'Arctos | Live crypto trading intelligence';
  }, [view]);

  if (!view) {
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
