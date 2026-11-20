import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { AuthProvider } from './contexts/AuthProvider';
import { PaperProvider } from './contexts/PaperProvider';
import { Toaster } from './components/ui/sonner';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Homepage } from './components/Homepage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/ui/common';
import { useHashView, type ViewId } from './hooks/useHashView';
import { navItem } from './components/navigation';
import { prefetchView, VIEW_LOADERS, whenIdle } from './viewLoaders';

const DashboardView = lazy(VIEW_LOADERS.dashboard);
const TradingTerminal = lazy(VIEW_LOADERS.trading);
const SniperPanel = lazy(VIEW_LOADERS.sniper);
const TradeBook = lazy(VIEW_LOADERS.tradebook);
const WhaleAlert = lazy(VIEW_LOADERS.whale);
const FundamentalNews = lazy(VIEW_LOADERS.news);
const StocksPreIPO = lazy(VIEW_LOADERS.stocks);
const AIChat = lazy(VIEW_LOADERS.chat);
const Settings = lazy(VIEW_LOADERS.settings);

// Dialogs load the first time they open, which keeps their code out of the first page load.
const WaitlistModal = lazy(() => import('./components/WaitlistModal').then((m) => ({ default: m.WaitlistModal })));
const WalletConnectionModal = lazy(() => import('./components/WalletConnectionModal').then((m) => ({ default: m.WalletConnectionModal })));
const EmailAuthModal = lazy(() => import('./components/EmailAuthModal').then((m) => ({ default: m.EmailAuthModal })));

/** True from the first time `open` is true, so a dialog stays mounted for its closing animation. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened;
}

// Icons are duotone everywhere unless a component asks for another weight.
const ICON_DEFAULTS = { color: 'currentColor', size: '1em', weight: 'duotone' as const, mirrored: false };

function Shell() {
  const { view, navigate } = useHashView();
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const waitlistReady = useOpenedOnce(waitlistOpen);
  const walletReady = useOpenedOnce(walletOpen);
  const emailReady = useOpenedOnce(emailOpen);

  // Once the first screen is up, quietly fetch the page most people open next.
  useEffect(() => {
    whenIdle(() => prefetchView(view ? 'trading' : 'dashboard'));
  }, [view]);

  // "Get started" always gives access. No sign in, wallet or waitlist is needed to use the app.
  const launch = useCallback((target: ViewId = 'dashboard') => navigate(target), [navigate]);

  useEffect(() => {
    document.title = view ? `${navItem(view).label} | Arctos` : 'Arctos | Live crypto trading intelligence';
  }, [view]);

  if (!view) {
    return (
      <>
        <Homepage onLaunch={launch} onOpenWaitlist={() => setWaitlistOpen(true)} onOpenWallet={() => setWalletOpen(true)} />
        <Suspense fallback={null}>
          {waitlistReady && <WaitlistModal isOpen={waitlistOpen} onClose={() => setWaitlistOpen(false)} />}
          {walletReady && <WalletConnectionModal open={walletOpen} onOpenChange={setWalletOpen} />}
        </Suspense>
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
      <Suspense fallback={null}>
        {walletReady && <WalletConnectionModal open={walletOpen} onOpenChange={setWalletOpen} />}
        {emailReady && <EmailAuthModal open={emailOpen} onOpenChange={setEmailOpen} />}
      </Suspense>
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
