import { useEffect } from 'react';
import { BarChart3, BookOpen, Eye, Gauge, Home, MessageSquare, Newspaper, Settings, Target, TrendingUp, X } from 'lucide-react';
import arctosLogo from '../../assets/images/arctos-logo.png.png';
import type { ViewId } from '../hooks/useHashView';
import { usePaper } from '../contexts/paper-context';
import { formatPct, formatUsd, pnlClass } from '../lib/format';

const ITEMS: Array<{ id: ViewId; label: string; icon: typeof Gauge }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'trading', label: 'Trading Terminal', icon: BarChart3 },
  { id: 'sniper', label: 'Sniper Engine', icon: Target },
  { id: 'tradebook', label: 'Trade Book', icon: BookOpen },
  { id: 'whale', label: 'Whale Alerts', icon: Eye },
  { id: 'news', label: 'Fundamental News', icon: Newspaper },
  { id: 'stocks', label: 'Stocks & PRE-IPO', icon: TrendingUp },
  { id: 'chat', label: 'AI Chat', icon: MessageSquare },
];

interface Props {
  active: ViewId;
  onNavigate: (v: ViewId | null) => void;
  open: boolean;
  onClose: () => void;
}

function NavButton({ id, label, Icon, active, onClick }: { id: ViewId; label: string; Icon: typeof Gauge; active: boolean; onClick: () => void }) {
  return (
    <button
      key={id}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20 font-medium' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 border border-transparent'
      }`}
    >
      <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2 : 1.5} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function Sidebar({ active, onNavigate, open, onClose }: Props) {
  const paper = usePaper();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const go = (v: ViewId | null) => {
    onNavigate(v);
    onClose();
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800/60 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-5 border-b border-zinc-800/60 flex items-center justify-between">
          <button onClick={() => go(null)} className="flex items-center gap-3 text-left" aria-label="Back to the Arctos homepage">
            <img src={arctosLogo} alt="" className="w-10 h-10 object-contain rounded-lg" />
            <div>
              <p className="text-lg font-bold tracking-tight text-white leading-tight">Arctos</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Trading Platform</p>
            </div>
          </button>
          <button onClick={onClose} className="lg:hidden p-2 text-zinc-400 hover:text-white" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 px-3 text-zinc-600">Navigation</p>
          {ITEMS.map((item) => (
            <NavButton key={item.id} id={item.id} label={item.label} Icon={item.icon} active={active === item.id} onClick={() => go(item.id)} />
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-zinc-800/60 space-y-2">
          <button onClick={() => go('trading')} className="w-full text-left rounded-lg bg-violet-500/5 border border-violet-500/20 px-3 py-2.5 hover:bg-violet-500/10 transition-colors">
            <p className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">Paper account</p>
            <p className="text-white text-sm font-semibold tabular-nums">{formatUsd(paper.equity)}</p>
            <p className={`text-xs tabular-nums ${pnlClass(paper.totalPnl)}`}>{formatPct(paper.totalPnlPct)} all time</p>
          </button>
          <NavButton id="settings" label="Settings" Icon={Settings} active={active === 'settings'} onClick={() => go('settings')} />
          <button onClick={() => go(null)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200">
            <Home className="w-[18px] h-[18px]" strokeWidth={1.5} aria-hidden />
            <span>Back to home</span>
          </button>
        </div>
      </aside>
    </>
  );
}
