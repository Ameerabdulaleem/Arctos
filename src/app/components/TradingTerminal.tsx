import { lazy, Suspense, useState } from 'react';
import { ArrowsLeftRight, Flask, Swap } from '@phosphor-icons/react';
import { Loading, PageHeader } from './ui/common';
import { SwapTerminal } from './swap/SwapTerminal';

// The practice terminal pulls in the candle chart library, so it loads only when opened.
const PracticeTerminal = lazy(() => import('./PracticeTerminal').then((m) => ({ default: m.PracticeTerminal })));

type Tab = 'swap' | 'practice';

export function TradingTerminal() {
  const [tab, setTab] = useState<Tab>('swap');
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <PageHeader
        icon={<ArrowsLeftRight />} tone="mint" title="Trading Terminal"
        subtitle={tab === 'swap' ? 'Spot swaps and bridges across Solana, BNB Chain, Ethereum, Base and more, at the best route we can find.' : 'Practice spot trading with paper money on live Binance prices.'}
        actions={
          <div className="seg flex" role="tablist" aria-label="Terminal mode">
            <button type="button" role="tab" aria-selected={tab === 'swap'} onClick={() => setTab('swap')} className="seg-item flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium">
              <Swap className="h-4 w-4" aria-hidden /> Swap and bridge
            </button>
            <button type="button" role="tab" aria-selected={tab === 'practice'} onClick={() => setTab('practice')} className="seg-item flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium">
              <Flask className="h-4 w-4" aria-hidden /> Practice
            </button>
          </div>
        }
      />
      {tab === 'swap' ? (
        <SwapTerminal />
      ) : (
        <Suspense fallback={<Loading label="Loading the practice terminal" />}>
          <PracticeTerminal />
        </Suspense>
      )}
    </div>
  );
}
