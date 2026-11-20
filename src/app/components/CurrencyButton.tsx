import { lazy, Suspense, useState } from 'react';
import { CaretDown, CircleNotch } from '@phosphor-icons/react';
import { chosenCurrency, currencyName, currencySymbol, useCurrency, useRates } from '../lib/currency';

// The list and its dialog load only when someone opens them, so the top bar stays light.
const CurrencyDialog = lazy(() => import('./CurrencyDialog'));

/** Shows the display currency and opens the picker. */
export function CurrencyButton({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useCurrency(); // re-render when the currency changes
  const { loading } = useRates();
  const code = chosenCurrency();
  const label = `Display currency: ${currencyName(code)}. Change`;

  const show = () => {
    setMounted(true);
    setOpen(true);
  };

  return (
    <>
      {variant === 'compact' ? (
        <button type="button" onClick={show} onPointerEnter={() => void import('./CurrencyDialog')} aria-label={label} title="Change the currency amounts are shown in"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.08]">
          <span className="text-sm leading-none text-white" aria-hidden>{currencySymbol(code)}</span>
          <span>{code}</span>
          {loading ? <CircleNotch className="h-3 w-3 animate-spin text-zinc-400" aria-hidden /> : <CaretDown className="h-3 w-3 text-zinc-400" aria-hidden />}
        </button>
      ) : (
        <button type="button" onClick={show} aria-label={label}
          className="inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-left transition hover:border-white/25 hover:bg-white/[0.09]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-400/25 to-violet-400/25 text-base font-semibold text-white" aria-hidden>{currencySymbol(code)}</span>
          <span>
            <span className="block text-sm font-semibold text-white">{currencyName(code)}</span>
            <span className="block text-xs text-zinc-400">{code}{loading ? ', loading today’s rate' : ''}</span>
          </span>
          <CaretDown className="ml-2 h-4 w-4 text-zinc-400" aria-hidden />
        </button>
      )}
      {mounted && (
        <Suspense fallback={null}>
          <CurrencyDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
