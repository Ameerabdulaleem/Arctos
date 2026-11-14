import type { ReactNode } from 'react';
import { ArrowsClockwise, CircleNotch, Warning } from '@phosphor-icons/react';

export type Tone = 'ice' | 'violet' | 'mint' | 'amber' | 'rose' | 'neutral';

/** A glass panel. The base surface for every block of content. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

const TILE_SIZES = {
  sm: 'h-8 w-8 rounded-lg text-[16px]',
  md: 'h-10 w-10 text-[20px]',
  lg: 'h-12 w-12 rounded-2xl text-[24px]',
};

/** A duotone icon on a softly lit, tinted tile. */
export function IconTile({ children, tone = 'ice', size = 'md', className = '' }: { children: ReactNode; tone?: Tone; size?: keyof typeof TILE_SIZES; className?: string }) {
  return (
    <span data-tone={tone} className={`icon-tile ${TILE_SIZES[size]} ${className}`} aria-hidden>
      {children}
    </span>
  );
}

export function PageHeader({ icon, tone = 'ice', title, subtitle, badge, actions }: { icon?: ReactNode; tone?: Tone; title: string; subtitle?: string; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between motion-safe:animate-fade-up">
      <div className="flex min-w-0 items-center gap-4">
        {icon && <IconTile tone={tone} size="lg">{icon}</IconTile>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px] sm:leading-8">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading live data' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-10 text-sm text-zinc-400">
      <CircleNotch className="h-4 w-4 animate-spin text-blue-300" weight="bold" aria-hidden />
      {label}...
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100">
      <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 font-medium text-amber-200 hover:text-white">
          <ArrowsClockwise className="h-3.5 w-3.5" weight="bold" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {icon && <IconTile tone="neutral" size="lg" className="mb-3">{icon}</IconTile>}
      <p className="font-medium text-zinc-200">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'zinc'; children: ReactNode }) {
  const tones = {
    green: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
    amber: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
    red: 'text-rose-300 border-rose-400/25 bg-rose-400/10',
    blue: 'text-blue-300 border-blue-400/25 bg-blue-400/10',
    violet: 'text-violet-300 border-violet-400/25 bg-violet-400/10',
    zinc: 'text-zinc-300 border-white/10 bg-white/[0.04]',
  };
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function PaperBadge() {
  return (
    <span
      title="Orders are simulated against live prices. No real funds are used."
      className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-violet-300" aria-hidden />
      Paper trading
    </span>
  );
}

export function Updated({ at }: { at: number | null }) {
  if (!at) return null;
  return <span className="text-xs text-zinc-500">Updated {new Date(at).toLocaleTimeString()}</span>;
}

/** A placeholder bar shown while a value loads. */
export function Skeleton({ className = 'h-6 w-24' }: { className?: string }) {
  return <span className={`skeleton inline-block align-middle ${className}`} role="status" aria-label="Loading" />;
}
