import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
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
import { WaitlistModal } from './components/WaitlistModal';
import { toast } from 'sonner';

export default function App() {
  const [showHomepage, setShowHomepage] = useState(true);
  const [activeView, setActiveView] = useState('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState('en');
  const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);

  // Apply theme to document
  useEffect(() => {
    // Ensure the HTML element receives the correct theme class
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light-mode');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light-mode');
    }
  }, [theme]);

  // Developer bypass: Hold Shift and press D three times to bypass waitlist
  useEffect(() => {
    let shiftDCount = 0;
    let timeout: NodeJS.Timeout;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'D') {
        shiftDCount++;
        clearTimeout(timeout);
        
        if (shiftDCount === 3) {
          setShowHomepage(false);
          toast.success('Developer mode activated! 🚀');
          shiftDCount = 0;
        }
        
        timeout = setTimeout(() => {
          shiftDCount = 0;
        }, 1000);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeout);
    };
  }, []);

  const handleGetStarted = () => {
    // Instead of allowing access, show waitlist modal
    setWaitlistModalOpen(true);
    toast.info('Arctos is launching soon! Join our waitlist to get early access.');
  };

  // Show homepage first
  if (showHomepage) {
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
      <div className={`size-full flex flex-col app-bg ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}>
        {/* Top Bar with Back Button */}
        <div className={`px-6 py-4 border-b ${theme === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-gray-200 bg-gray-50'}`}>
          <button
            onClick={() => setShowHomepage(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              theme === 'dark'
                ? 'text-zinc-300 hover:bg-zinc-800'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <ArrowLeft size={20} />
            <span>Back to Home</span>
          </button>
        </div>
        
        <div className={`flex-1 flex ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}>
          <Sidebar activeView={activeView} setActiveView={setActiveView} theme={theme} />
          <main className="flex-1 overflow-auto">
            {renderView()}
          </main>
        </div>
      </div>
      <Toaster theme={theme === 'dark' ? 'dark' : 'light'} />
      <WaitlistModal isOpen={waitlistModalOpen} onClose={() => setWaitlistModalOpen(false)} theme={theme} />
    </AuthProvider>
  );
}