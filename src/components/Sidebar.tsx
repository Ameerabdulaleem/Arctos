import { Home, BarChart3, Zap, Bell, MessageSquare, Settings, TrendingUp, BookOpen, Wallet, LogOut, User, Newspaper } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { WalletConnectionModal } from './WalletConnectionModal';
import { EmailAuthModal } from './EmailAuthModal';
import { toast } from 'sonner';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  theme: 'dark' | 'light';
}

export function Sidebar({ activeView, setActiveView, theme }: SidebarProps) {
  const { user, isAuthenticated, isWalletConnected, disconnectWallet, signOut } = useAuth();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [emailAuthModalOpen, setEmailAuthModalOpen] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'trading', label: 'Trading Terminal', icon: BarChart3 },
    { id: 'sniper', label: 'Sniper Panel', icon: Zap },
    { id: 'whale', label: 'Whale Alerts', icon: TrendingUp },
    { id: 'news', label: 'Fundamental News', icon: Newspaper },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare },
    { id: 'tradebook', label: 'Trade Book', icon: BookOpen },
  ];

  const isDark = theme === 'dark';

  const handleSignOut = () => {
    signOut();
    toast.success('Signed out successfully');
  };

  const handleDisconnectWallet = () => {
    disconnectWallet();
    toast.success('Wallet disconnected');
  };

  return (
    <div className={`w-64 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border-r flex flex-col h-full`}>
      {/* Logo */}
      <div className={`p-6 border-b ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
        <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'} flex items-center gap-3`}>
          {/* FIXED: Use URL instead of Figma import */}
          <img 
            src="https://placehold.co/600x400/1e40af/ffffff?text=ARCTOS+LOGO" 
            alt="Arctos" 
            className="w-14 h-14 object-contain rounded-lg" 
          />
          Arctos
        </h1>
      </div>

      {/* Rest of your Sidebar code remains the same */}
      <div className={`p-4 border-b ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
        {isAuthenticated ? (
          <div className="space-y-2">
            <div className={`p-3 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {isWalletConnected ? (
                  <>
                    <Wallet className="w-4 h-4 text-blue-500" />
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      Wallet
                    </span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4 text-blue-500" />
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      Email Account
                    </span>
                  </>
                )}
              </div>
              <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-600'} truncate`}>
                Connected
              </div>
            </div>
            <button
              onClick={isWalletConnected ? handleDisconnectWallet : handleSignOut}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                isDark
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
              }`}
            >
              <LogOut className="w-4 h-4" />
              {isWalletConnected ? 'Disconnect' : 'Sign Out'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setWalletModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
            <button
              onClick={() => setEmailAuthModalOpen(true)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                isDark
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
              }`}
            >
              <User className="w-4 h-4" />
              Sign In
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveView(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeView === item.id
                      ? 'bg-blue-600 text-white'
                      : isDark 
                        ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                        : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Settings */}
      <div className={`p-4 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
        <button 
          onClick={() => setActiveView('settings')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            activeView === 'settings'
              ? 'bg-blue-600 text-white'
              : isDark
                ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>
      </div>

      {/* Auth Modals - We'll create these next */}
      {/* <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
      <EmailAuthModal open={emailAuthModalOpen} onOpenChange={setEmailAuthModalOpen} /> */}
    </div>
  );
}