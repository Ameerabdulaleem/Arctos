import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { IconContext } from '@phosphor-icons/react';
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
import { navItem } from './components/navigation';

const DashboardView = lazy(() => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })));
const TradingTerminal = lazy(() => import('./components/TradingTerminal').then((m) => ({ default: m.TradingTerminal })));
const SniperPanel = lazy(() => import('./components/SniperPanel').then((m) => ({ default: m.SniperPanel })));
const TradeBook = lazy(() => import('./components/TradeBook').then((m) => ({ default: m.TradeBook })));
const WhaleAlert = lazy(() => import('./components/WhaleAlert').then((m) => ({ default: m.WhaleAlert })));
const FundamentalNews = lazy(() => import('./components/FundamentalNews').then((m) => ({ default: m.FundamentalNews })));
const StocksPreIPO = lazy(() => import('./components/StocksPreIPO').then((m) => ({ default: m.StocksPreIPO })));
const AIChat = lazy(() => import('./components/AIChat').then((m) => ({ default: m.AIChat })));
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));

// Icons are duotone everywhere unless a component asks for another weight.
const ICON_DEFAULTS = { color: 'currentColor', size: '1em', weight: 'duotone' as const, mirrored: false };

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
    document.title = view ? `${navItem(view).label} | Arctos` : 'Arctos | Live crypto trading intelligence';
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
    <div className="flex h-dvh overflow-hidden text-zinc-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-black">Skip to content</a>
      <Sidebar active={view} onNavigate={navigate} open={menuOpen} onClose={closeMenu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={navItem(view).label} onMenu={() => setMenuOpen(true)} onConnectWallet={() => setWalletOpen(true)} onSignIn={() => setEmailOpen(true)} />
        <main className="flex-1 overflow-auto" id="main" tabIndex={-1}>
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
    <IconContext.Provider value={ICON_DEFAULTS}>
      <AuthProvider>
        <PaperProvider>
          <Shell />
          <Toaster position="bottom-right" />
        </PaperProvider>
      </AuthProvider>
    </IconContext.Provider>
  );
}
