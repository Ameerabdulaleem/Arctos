import { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { chosenCurrency, currencyName, loadRates, POPULAR, setCurrency, suggestedCurrency, symbolStyle, useRates } from '../lib/currency';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

function rateText(code: string, rate: number | undefined): string {
  if (code === 'USD') return 'Base currency';
  if (rate == null) return 'No rate today';
  try {
    const f = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: symbolStyle(code), maximumFractionDigits: rate >= 100 ? 2 : 4 });
    return `$1 = ${f.format(rate)}`;
  } catch {
    return `$1 = ${rate} ${code}`;
  }
}

function Row({ code, rate, selected, onPick }: { code: string; rate: number | undefined; selected: boolean; onPick: (code: string) => void }) {
  const usable = code === 'USD' || rate != null;
  return (
    <button type="button" disabled={!usable} onClick={() => onPick(code)} aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'bg-blue-400/15 ring-1 ring-blue-300/40' : 'hover:bg-white/[0.06]'}`}>
      <span className="num w-11 shrink-0 text-sm font-semibold text-white">{code}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{currencyName(code)}</span>
      <span className="num shrink-0 text-xs text-zinc-500">{rateText(code, rate)}</span>
      {selected && <CheckCircle className="h-4 w-4 shrink-0 text-blue-300" weight="fill" aria-hidden />}
    </button>
  );
}

export default function CurrencyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { rates, date, loading, failed } = useRates();
  const [text, setText] = useState('');
  const chosen = chosenCurrency();
  const suggested = useMemo(() => suggestedCurrency(), []);

  useEffect(() => {
    if (open) void loadRates();
  }, [open]);

  const all = useMemo(() => {
    const codes = new Set<string>([...POPULAR, ...Object.keys(rates)]);
    return [...codes].sort((a, b) => (a === 'USD' ? -1 : b === 'USD' ? 1 : currencyName(a).localeCompare(currencyName(b))));
  }, [rates]);

  const q = text.trim().toLowerCase();
  const matches = (code: string) => !q || code.toLowerCase().includes(q) || currencyName(code).toLowerCase().includes(q);
  const top = (q ? [] : [...new Set([...(suggested && suggested !== 'USD' ? [suggested] : []), ...POPULAR])]);
  const rest = all.filter((c) => matches(c) && !top.includes(c));

  const pick = (code: string) => {
    setCurrency(code);
    onOpenChange(false);
    setText('');
    toast.success(`Amounts now show in ${currencyName(code)}`, { description: code === 'USD' ? undefined : 'Converted from US dollars at today’s rate.' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Display currency</DialogTitle>
          <DialogDescription>Prices, balances and portfolio values are converted from US dollars at today’s rate. Swap amounts stay in the tokens you trade, and the practice account stays in USDT.</DialogDescription>
        </DialogHeader>

        <label className="relative block">
          <span className="sr-only">Search currencies</span>
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 40))} placeholder="Search, for example naira or NGN" className="field pl-9" spellCheck={false} autoComplete="off" />
        </label>

        {failed && Object.keys(rates).length <= 1 && (
          <p role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-3 text-sm text-amber-200">
            Today’s exchange rates could not be loaded, so amounts stay in US dollars for now.
            <button type="button" onClick={() => void loadRates(true)} className="btn btn-secondary btn-sm shrink-0"><ArrowClockwise className="h-3.5 w-3.5" aria-hidden />Retry</button>
          </p>
        )}
        {loading && Object.keys(rates).length <= 1 && <p className="text-sm text-zinc-400">Loading today’s rates…</p>}

        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
          {top.length > 0 && (
            <>
              <p className="eyebrow px-1 pb-1">{suggested && suggested !== 'USD' ? 'Suggested and popular' : 'Popular'}</p>
              {top.map((c) => <Row key={`top:${c}`} code={c} rate={rates[c]} selected={c === chosen} onPick={pick} />)}
            </>
          )}
          {rest.length > 0 && <p className="eyebrow px-1 pb-1 pt-3">{q ? 'Results' : 'All currencies'}</p>}
          {rest.map((c) => <Row key={c} code={c} rate={rates[c]} selected={c === chosen} onPick={pick} />)}
          {q && rest.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">No currency matches “{text.trim()}”.</p>}
        </div>

        {date && <p className="text-[11px] text-zinc-500">Rates from {date}, updated daily. Token prices themselves still move live.</p>}
      </DialogContent>
    </Dialog>
  );
}
