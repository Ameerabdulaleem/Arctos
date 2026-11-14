import { useEffect } from 'react';
import { ArrowUpRight, Flask, House, X } from '@phosphor-icons/react';
import arctosLogo from '../../assets/images/arctos-logo.png.png';
import type { ViewId } from '../hooks/useHashView';
import { usePaper } from '../contexts/paper-context';
import { formatPct, formatUsd, pnlClass } from '../lib/format';
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './navigation';

interface Props {
  active: ViewId;
  onNavigate: (v: ViewId | null) => void;
  open: boolean;
  onClose: () => void;
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition duration-150 ${
        active ? 'bg-white/[0.07] font-medium text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
      }`}
    >
      {active && <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-blue-200 to-blue-500 shadow-glow-sm" aria-hidden />}
      <span
        data-tone={active ? item.tone : 'neutral'}
        className={`icon-tile h-8 w-8 rounded-lg text-[17px] transition ${active ? '' : 'border-white/[0.06] text-zinc-400 group-hover:text-zinc-100'}`}
        aria-hidden
      >
        <Icon weight={active ? 'duotone' : 'regular'} />
      </span>
      <span className="truncate">{item.label}</span>
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
      {open && <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Main navigation"
        className={`glass fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-y-0 border-l-0 transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-4 pt-5">
          <button onClick={() => go(null)} className="flex items-center gap-3 rounded-xl text-left" aria-label="Back to the Arctos homepage">
            <span className="ring-gradient flex h-11 w-11 items-center justify-center rounded-2xl bg-black/50 shadow-glow-sm">
              <img src={arctosLogo} alt="" className="h-9 w-9 rounded-xl object-contain" />
            </span>
            <span>
              <span className="block text-[17px] font-semibold leading-tight tracking-tight text-white">Arctos</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">Market intelligence</span>
            </span>
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-icon lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" weight="bold" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="eyebrow px-2.5 pb-1 text-[10px] text-zinc-600">{group.label}</p>
              {group.items.map((item) => (
                <NavButton key={item.id} item={item} active={active === item.id} onClick={() => go(item.id)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="space-y-1 px-3 pb-4">
          <button onClick={() => go('trading')} className="ring-gradient group mb-2 block w-full rounded-2xl bg-gradient-to-br from-violet-500/[0.12] via-white/[0.02] to-blue-500/[0.1] px-3.5 py-3 text-left transition hover:from-violet-500/20 hover:to-blue-500/[0.16]">
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                <Flask className="h-3.5 w-3.5" aria-hidden /> Paper account
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500 transition group-hover:text-white" weight="bold" aria-hidden />
            </span>
            <span className="num mt-1.5 block text-lg font-semibold text-white">{formatUsd(paper.equity)}</span>
            <span className={`num block text-xs ${pnlClass(paper.totalPnl)}`}>{formatPct(paper.totalPnlPct)} all time</span>
          </button>
          <NavButton item={SETTINGS_ITEM} active={active === 'settings'} onClick={() => go('settings')} />
          <button onClick={() => go(null)} className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100">
            <span data-tone="neutral" className="icon-tile h-8 w-8 rounded-lg border-white/[0.06] text-[17px] text-zinc-400 group-hover:text-zinc-100" aria-hidden>
              <House weight="regular" />
            </span>
            <span>Back to home</span>
          </button>
        </div>
      </aside>
    </>
  );
}
