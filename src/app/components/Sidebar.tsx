import { Gauge, BarChart3, Target, MessageSquare, Settings, Eye, BookOpen, Newspaper } from 'lucide-react';
import arctosLogo from '../../assets/images/arctos-logo.png.png';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  theme: 'dark' | 'light';
}

export function Sidebar({ activeView, setActiveView, theme }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Gauge },
    { id: 'trading', label: 'Trading Terminal', icon: BarChart3 },
    { id: 'sniper', label: 'Sniper Engine', icon: Target },
    { id: 'tradebook', label: 'Trade Book', icon: BookOpen },
    { id: 'whale', label: 'Whale Alerts', icon: Eye },
    { id: 'news', label: 'Fundamental News', icon: Newspaper },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare },
  ];

  const isDark = theme === 'dark';

  return (
    <div className={`w-64 ${isDark ? 'bg-zinc-950 border-zinc-800/60' : 'bg-gray-50 border-gray-200'} border-r flex flex-col h-full`}>
      {/* Logo */}
      <div className={`px-5 py-5 border-b ${isDark ? 'border-zinc-800/60' : 'border-gray-200'}`}>
        <div className="flex items-center gap-3">
          <img 
            src={arctosLogo} 
            alt="Arctos" 
            className="w-10 h-10 object-contain rounded-lg" 
          />
          <div>
            <h1 className={`text-lg font-bold tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Arctos
            </h1>
            <p className={`text-[10px] font-medium uppercase tracking-widest ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
              Trading Platform
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className={`text-[10px] font-semibold uppercase tracking-widest mb-3 px-3 ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
          Navigation
        </p>
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveView(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-sm ${
                    isActive
                      ? isDark
                        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20 shadow-sm shadow-blue-500/5'
                        : 'bg-blue-50 text-blue-600 border border-blue-200'
                      : isDark 
                        ? 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] ${isActive ? '' : 'opacity-70'}`} strokeWidth={isActive ? 2 : 1.5} />
                  <span className={`font-medium ${isActive ? '' : 'font-normal'}`}>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Settings */}
      <div className={`px-3 py-3 border-t ${isDark ? 'border-zinc-800/60' : 'border-gray-200'}`}>
        <button 
          onClick={() => setActiveView('settings')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-sm ${
            activeView === 'settings'
              ? isDark
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
                : 'bg-blue-50 text-blue-600 border border-blue-200'
              : isDark
                ? 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <Settings className="w-[18px] h-[18px] opacity-70" strokeWidth={1.5} />
          <span>Settings</span>
        </button>

        {/* Version indicator */}
        <p className={`text-center text-[10px] mt-3 ${isDark ? 'text-zinc-700' : 'text-gray-300'}`}>
          v0.1.0 — Beta
        </p>
      </div>
    </div>
  );
}