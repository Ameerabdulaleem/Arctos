import { useEffect, useState } from 'react';
import { chainById, isNative } from './chains';
import { tokenPairs, usdPriceOf } from './dexscreener';
import type { Token } from './types';

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'BUSD', 'USDC.E', 'USD1', 'PYUSD']);

/** A token's US dollar price from DexScreener, refreshed every 30 seconds. Null until known. */
export function useTokenUsdPrice(token: Token | null): number | null {
  const chain = token ? chainById(token.chainId) : undefined;
  const address = token && chain ? (isNative(chain, token.address) ? chain.wrapped : token.address) : null;
  const stable = Boolean(token && STABLES.has(token.symbol.toUpperCase()) && token.verified);
  const key = chain && address && !stable ? `${chain.dexscreener}:${address}` : '';
  const [state, setState] = useState<{ key: string; price: number | null } | null>(null);

  useEffect(() => {
    if (!key || !chain || !address) return;
    let live = true;
    const load = () =>
      tokenPairs(chain.dexscreener, address)
        .then((pairs) => live && setState({ key, price: usdPriceOf(pairs, address) }))
        .catch(() => live && setState((s) => (s?.key === key ? s : { key, price: null })));
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [key, chain, address]);

  if (stable) return 1;
  return state?.key === key ? state.price : null;
}
