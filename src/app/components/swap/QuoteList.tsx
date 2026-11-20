import { CheckCircle, Clock, GasPump, Lightning } from '@phosphor-icons/react';
import { costUsd, netUsd, outputUnitUsd, PROVIDER_LABELS, type QuoteFailure } from '../../swap/aggregate';
import { formatAmount } from '../../swap/amount';
import type { ProviderId, Quote, Token } from '../../swap/types';
import { formatUsd } from '../../lib/format';

function eta(sec: number | null): string | null {
  if (sec == null) return null;
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  return `${Math.round(sec / 60)} min`;
}

interface Props {
  quotes: Quote[];
  failures: QuoteFailure[];
  to: Token;
  selected: ProviderId | null;
  onSelect: (id: ProviderId) => void;
  loading: boolean;
}

export function QuoteList({ quotes, failures, to, selected, onSelect, loading }: Props) {
  if (quotes.length === 0 && !loading && failures.length === 0) return null;
  const best = quotes[0];
  const unit = outputUnitUsd(quotes, to);
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label="Routes">
      <div className="flex items-center justify-between px-0.5">
        <span className="eyebrow">Routes compared</span>
        {loading && <span className="text-[11px] text-zinc-500">Refreshing…</span>}
      </div>
      {quotes.map((q) => {
        const active = (selected ?? best?.provider) === q.provider;
        const net = netUsd(q, unit, to);
        const diffPct = best && q !== best && best.amountOut > 0n ? Number(((q.amountOut - best.amountOut) * 10_000n) / best.amountOut) / 100 : null;
        return (
          <button
            key={q.provider}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(q.provider)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-blue-300/45 bg-blue-400/[0.09]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                {active && <CheckCircle className="h-4 w-4 text-blue-300" weight="fill" aria-hidden />}
                {PROVIDER_LABELS[q.provider]}
                {q === best && <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Best</span>}
              </span>
              <span className="num text-sm font-semibold text-white">
                {formatAmount(q.amountOut, to.decimals)} <span className="text-xs font-normal text-zinc-400">{to.symbol}</span>
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
              {net != null && <span className="num">≈ {formatUsd(net)} after costs</span>}
              {diffPct != null && diffPct < 0 && <span className="num text-rose-300/90">{diffPct.toFixed(2)}%</span>}
              {costUsd(q) > 0 && <span className="inline-flex items-center gap-1"><GasPump className="h-3 w-3" aria-hidden />{costUsd(q) < 0.01 ? `under ${formatUsd(0.01)}` : formatUsd(costUsd(q))}</span>}
              {eta(q.etaSec) && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{eta(q.etaSec)}</span>}
              {q.route.length > 0 && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Lightning className="h-3 w-3 shrink-0" aria-hidden />{q.route.join(', ')}</span>}
            </div>
          </button>
        );
      })}
      {failures.length > 0 && (
        <details className="px-0.5 text-[11px] text-zinc-500">
          <summary className="cursor-pointer select-none">{failures.length} {failures.length === 1 ? 'provider' : 'providers'} had no route</summary>
          <ul className="mt-1 space-y-0.5">
            {failures.map((f) => <li key={f.provider}>{PROVIDER_LABELS[f.provider]}: {f.message}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
