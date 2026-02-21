import { Gauge, BarChart3, Target, MessageSquare, Settings, Eye, BookOpen, Newspaper } from 'lucide-react';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  theme: 'dark' | 'light';
}

export function Sidebar({ activeView, setActiveView, theme }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Gauge },
    { id: 'trading', label: 'Trading Terminal', icon: BarChart3 },
    { id: 'sniper', label: 'Sniper Panel', icon: Target },
    { id: 'whale', label: 'Whale Alerts', icon: Eye },
    { id: 'news', label: 'Fundamental News', icon: Newspaper },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare },
    { id: 'tradebook', label: 'Trade Book', icon: BookOpen },
  ];

  const isDark = theme === 'dark';

  return (
    <div className={`w-64 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-200'} border-r flex flex-col h-full`}>
      {/* Logo */}
      <div className={`p-6 border-b ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
        <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'} flex items-center gap-3`}>
          {/* FIXED: Use URL instead of Figma import */}
          <img 
            src="https://placehold.co/600x400/1e40af/ffffff?text=ARCTOS+LOGO" 
            alt="Arctos" 
            className="w-14 h-14 object-contain drop-shadow-lg" 
          />
          Arctos
        </h1>
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
                  <Icon className="w-[18px] h-[18px]" strokeWidth={1.5} />
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
          <Settings className="w-[18px] h-[18px]" strokeWidth={1.5} />
          <span>Settings</span>
        </button>
      </div>

      {/* Auth Modals - We'll create these next */}
      {/* <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
      <EmailAuthModal open={emailAuthModalOpen} onOpenChange={setEmailAuthModalOpen} /> */}
    </div>
  );
}