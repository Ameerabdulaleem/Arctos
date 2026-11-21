import { chainByKey, looksLikeAddress } from '../swap/chains';
import { safeHref } from './format';

/** DexScreener's chain ids differ from Arctos chain keys for a few chains. */
const DEX_CHAIN: Record<string, string> = { bsc: 'bsc', ethereum: 'ethereum', solana: 'solana', base: 'base' };

/** A token's DexScreener page: its pool link when known, else DexScreener finds the pool from the contract. */
export function dexscreenerUrl(chain: string, address: string, pairUrl?: string | null): string {
  const given = safeHref(pairUrl);
  if (given && given.startsWith('https://dexscreener.com/')) return given;
  return `https://dexscreener.com/${encodeURIComponent(DEX_CHAIN[chain] ?? chain)}/${encodeURIComponent(address)}`;
}


/** The swap terminal opened on a token, when the chain is one it trades on. */
export function swapHref(chainKey: string, address: string): string | null {
  const chain = chainByKey(chainKey);
  return chain && looksLikeAddress(chain, address) ? `#/trading?chain=${encodeURIComponent(chain.key)}&token=${encodeURIComponent(address)}` : null;
}

/** A wallet's page on the chain's explorer. */
export function walletUrl(chainKey: string, address: string): string | null {
  const chain = chainByKey(chainKey);
  if (!chain || !looksLikeAddress(chain, address)) return null;
  return `${chain.explorer}/${chain.vm === 'svm' ? 'account' : 'address'}/${encodeURIComponent(address)}`;
}
