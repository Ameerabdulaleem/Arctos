import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { shortAddress } from '../../lib/format';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some embedded views: copy through a hidden field.
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface Props {
  value: string;
  /** Read out to screen readers, for example "Copy BONK contract address". */
  label?: string;
  /** Also show the shortened address next to the icon. */
  show?: boolean;
  className?: string;
  size?: 'xs' | 'sm';
}

/** A one click copy for a contract or wallet address. */
export function CopyAddress({ value, label = 'Copy contract address', show = false, className = '', size = 'xs' }: Props) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (e: React.MouseEvent) => {
    // Never let the click reach a row or card that has its own action.
    e.preventDefault();
    e.stopPropagation();
    if (!(await writeClipboard(value))) {
      toast.error('Could not copy. Select the address and copy it by hand.');
      return;
    }
    setDone(true);
    toast.success('Address copied', { description: shortAddress(value, 8, 6) });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1500);
  };

  const icon = size === 'sm' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={`${label}: ${value}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-zinc-400 transition hover:bg-white/[0.08] hover:text-white focus-visible:text-white ${className}`}
    >
      {show && <span className="num text-[11px]">{shortAddress(value, 4, 4)}</span>}
      {done ? <Check className={`${icon} text-emerald-300`} weight="bold" aria-hidden /> : <Copy className={icon} aria-hidden />}
    </button>
  );
}
