import { useEffect, useMemo, useState } from 'react';
import { portfolioService, type Holding } from '../services/portfolioService';
import { chainByKey, EVM_NATIVE, isNative, SOL_MINT } from './chains';
import type { Token } from './types';

/** A token the connected wallet holds, with its exact balance. */
export interface HeldToken {
  token: Token;
  raw: bigint;
  usd: number | null;
}

const REFRESH_MS = 60_000;

/** Turns a wallet holding from the data service into a swappable token. */
export function heldFromHolding(h: Holding): HeldToken | null {
  const chain = chainByKey(h.chain);
  if (!chain) return null;
  const address = h.address ?? (chain.vm === 'svm' ? SOL_MINT : EVM_NATIVE);
  const native = isNative(chain, address);
  const decimals = h.decimals ?? (native ? chain.native.decimals : undefined);
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (!h.rawAmount || !/^\d{1,78}$/.test(h.rawAmount)) return null;
  const raw = BigInt(h.rawAmount);
  if (raw === 0n) return null;
  return {
    token: {
      chainId: chain.id,
      address: chain.vm === 'evm' && !native ? address.toLowerCase() : address,
      symbol: (native ? chain.native.symbol : h.symbol).slice(0, 16),
      name: (native ? chain.native.name : h.name).slice(0, 48),
      decimals,
      logo: h.logo && h.logo.startsWith('https://') ? h.logo : undefined,
      verified: native || h.verified !== false,
    },
    raw,
    usd: h.valueUsd,
  };
}

/** Everything the connected wallets hold, grouped by chain id. Refreshed every minute and after a swap. */
export function useWalletHoldings(addresses: Array<string | null | undefined>, refreshKey = 0) {
  const list = addresses.filter((a): a is string => Boolean(a));
  const key = list.join('|');
  const [state, setState] = useState<{ key: string; byChain: Map<number, HeldToken[]> }>({ key: '', byChain: new Map() });

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        const results = await Promise.allSettled(key.split('|').map((a) => portfolioService.get(a, ctrl.signal)));
        if (ctrl.signal.aborted) return;
        const byChain = new Map<number, HeldToken[]>();
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          for (const h of r.value.holdings) {
            const held = heldFromHolding(h);
            if (!held) continue;
            const list = byChain.get(held.token.chainId) ?? [];
            list.push(held);
            byChain.set(held.token.chainId, list);
          }
        }
        setState({ key, byChain });
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, refreshKey]);

  return useMemo(() => (state.key === key ? state.byChain : new Map<number, HeldToken[]>()), [state, key]);
}
