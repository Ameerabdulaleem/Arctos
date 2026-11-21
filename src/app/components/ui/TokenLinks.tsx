import { useState } from 'react';
import { ArrowSquareOut, ChartLineUp } from '@phosphor-icons/react';
import { chainByKey, tokenUrl } from '../../swap/chains';
import { dexscreenerUrl } from '../../lib/tokenLinks';
import { CopyAddress } from './CopyAddress';

function DexIcon() {
  const [broken, setBroken] = useState(false);
  return broken
    ? <ChartLineUp className="h-3.5 w-3.5" aria-hidden />
    : <img src="https://dexscreener.com/favicon.png" alt="" width={14} height={14} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-3.5 w-3.5 rounded-sm" />;
}

/** Copy the contract, open it in the chain's explorer, or open it on DexScreener. */
export function TokenLinks({ chain, address, symbol, pairUrl, className = '' }: { chain: string; address: string; symbol: string; pairUrl?: string | null; className?: string }) {
  const swapChain = chainByKey(chain);
  const explorer = swapChain ? tokenUrl(swapChain, address) : null;
  const link = 'inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/[0.08] hover:text-white';
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <CopyAddress value={address} label={`Copy ${symbol} contract address`} />
      {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className={link} aria-label={`Open the ${symbol} contract in the explorer`} title="Open the contract"><ArrowSquareOut className="h-3.5 w-3.5" /></a>}
      <a href={dexscreenerUrl(chain, address, pairUrl)} target="_blank" rel="noopener noreferrer" className={link} aria-label={`Open ${symbol} on DexScreener`} title="Open on DexScreener"><DexIcon /></a>
    </span>
  );
}
