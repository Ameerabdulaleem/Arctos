import { useEffect, useId, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`arctos_open_${key}`);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/**
 * A section that opens and closes from its header, remembering its state on this device.
 * `summary` is shown beside the title while it is closed.
 */
export function Collapsible({ id, title, icon, summary, defaultOpen = false, children, className = '' }: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const panel = useId();
  useEffect(() => {
    try {
      localStorage.setItem(`arctos_open_${id}`, open ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }, [id, open]);

  return (
    <section className={`panel ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panel}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left">
        {icon}
        <span className="font-semibold text-white">{title}</span>
        {!open && summary && <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{summary}</span>}
        <CaretDown className={`ml-auto h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div id={panel} className="px-5 pb-5">{children}</div>}
    </section>
  );
}
