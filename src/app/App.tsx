import { useState, useEffect } from 'react';
// Keep ALL imports - we'll create stub components for the ones we haven't built yet
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { TradingTerminal } from './components/TradingTerminal';
import { SniperPanel } from './components/SniperPanel';
import { WhaleAlert } from './components/WhaleAlert';
import { AIChat } from './components/AIChat';
import { Settings } from './components/Settings';
import { Homepage } from './components/Homepage';
import { TradeBook } from './components/TradeBook';
import { FundamentalNews } from './components/FundamentalNews';
import { AuthProvider } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';

// Development flag - set to true to show only homepage
const DEV_MODE = true; // Change to false when all components are ready

export default function App() {
  const [showHomepage, setShowHomepage] = useState(true);
  const [activeView, setActiveView] = useState('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState('en');

  // Apply theme to document
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
  }, [theme]);

  const handleGetStarted = () => {
    if (DEV_MODE) {
      alert("🚀 Dashboard coming soon! Follow my LinkedIn for updates.");
      return;
    }
    setShowHomepage(false);
  };

  // Show homepage first (or always in DEV_MODE)
  if (showHomepage || DEV_MODE) {
    return (
      <AuthProvider>
        <Homepage onGetStarted={handleGetStarted} theme={theme} />
        <Toaster theme={theme === 'dark' ? 'dark' : 'light'} />
      </AuthProvider>
    );
  }

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'trading':
        return <TradingTerminal />;
      case 'sniper':
        return <SniperPanel />;
      case 'whale':
        return <WhaleAlert />;
      case 'chat':
        return <AIChat />;
      case 'tradebook':
        return <TradeBook />;
      case 'news':
        return <FundamentalNews />;
      case 'settings':
        return <Settings theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <AuthProvider>
      <div className={`size-full flex ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}>
        <Sidebar activeView={activeView} setActiveView={setActiveView} theme={theme} />
        <main className="flex-1 overflow-auto">
          {renderView()}
        </main>
      </div>
      <Toaster theme={theme === 'dark' ? 'dark' : 'light'} />
    </AuthProvider>
  );
}