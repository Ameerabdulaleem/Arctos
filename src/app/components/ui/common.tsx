import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-zinc-900/80 border border-zinc-800/60 rounded-xl ${className}`}>{children}</section>;
}

export function PageHeader({ icon, title, subtitle, actions }: { icon?: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
          {icon && <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/15 text-blue-400 shrink-0">{icon}</span>}
          {title}
        </h1>
        {subtitle && <p className="text-zinc-500 text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading live data' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
      {label}...
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-amber-100 hover:text-white font-medium">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-zinc-300 font-medium">{title}</p>
      {children && <div className="text-zinc-500 text-sm mt-1">{children}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'zinc'; children: ReactNode }) {
  const tones = {
    green: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    amber: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    red: 'text-red-400 border-red-500/30 bg-red-500/10',
    blue: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    zinc: 'text-zinc-400 border-zinc-700 bg-zinc-800/60',
  };
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function PaperBadge() {
  return (
    <span title="Orders are simulated against live prices. No real funds are used." className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-violet-300 bg-violet-500/10 border border-violet-500/30">
      Paper trading
    </span>
  );
}

export function Updated({ at }: { at: number | null }) {
  if (!at) return null;
  return <span className="text-xs text-zinc-500">Updated {new Date(at).toLocaleTimeString()}</span>;
}
