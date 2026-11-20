// Token lists, search and on chain lookups for the swap panel.

import { createPublicClient, erc20Abi, http, type Address } from 'viem';
import { chainById, CHAINS, EVM_NATIVE, looksLikeAddress, RELAY_EVM_NATIVE, RELAY_SOL_NATIVE, SOL_MINT, type SwapChain } from './chains';
import { fetchJson } from './http';
import type { ProviderContext, Token } from './types';

export { looksLikeAddress } from './chains';

export function nativeToken(chain: SwapChain): Token {
  return {
    chainId: chain.id,
    address: chain.vm === 'svm' ? SOL_MINT : EVM_NATIVE,
    symbol: chain.native.symbol,
    name: chain.native.name,
    decimals: chain.native.decimals,
    verified: true,
  };
}

export function sameToken(a: Token | null, b: Token | null): boolean {
  if (!a || !b || a.chainId !== b.chainId) return false;
  return a.address.startsWith('0x') ? a.address.toLowerCase() === b.address.toLowerCase() : a.address === b.address;
}

/** Turns a Relay currency into a token, writing native coins the way Arctos does. */
export function fromRelayCurrency(c: unknown): Token | null {
  if (!c || typeof c !== 'object') return null;
  const r = c as Record<string, unknown>;
  const chainId = typeof r.chainId === 'number' ? r.chainId : null;
  const chain = chainId != null ? chainById(chainId) : undefined;
  if (!chain || typeof r.address !== 'string' || typeof r.decimals !== 'number' || typeof r.symbol !== 'string') return null;
  if (!Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 36) return null;
  let address = r.address;
  if (chain.vm === 'evm' && address === RELAY_EVM_NATIVE) address = EVM_NATIVE;
  if (chain.vm === 'svm' && address === RELAY_SOL_NATIVE) address = SOL_MINT;
  if (!looksLikeAddress(chain, address) && address !== EVM_NATIVE) return null;
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const logo = typeof meta.logoURI === 'string' && meta.logoURI.startsWith('https://') ? meta.logoURI : undefined;
  return {
    chainId: chain.id,
    address,
    symbol: r.symbol.slice(0, 16),
    name: typeof r.name === 'string' ? r.name.slice(0, 48) : r.symbol.slice(0, 16),
    decimals: r.decimals,
    logo,
    verified: meta.verified === true || address === EVM_NATIVE || address === SOL_MINT,
  };
}

let featuredCache: { base: string; at: number; value: Map<number, Token[]> } | null = null;

/** Popular tokens per chain, from Relay's chain list. Native coins only if Relay cannot be reached. */
export async function featuredTokens(ctx: ProviderContext, signal?: AbortSignal): Promise<Map<number, Token[]>> {
  if (featuredCache && featuredCache.base === ctx.relayBase && Date.now() - featuredCache.at < 10 * 60_000) return featuredCache.value;
  const value = new Map<number, Token[]>(CHAINS.map((c) => [c.id, [nativeToken(c)]]));
  try {
    const { body } = await fetchJson('Relay', `${ctx.relayBase}/chains`, { signal, timeoutMs: 10_000 });
    const chains = (body as { chains?: unknown[] })?.chains ?? [];
    for (const raw of chains) {
      const c = raw as { id?: unknown; featuredTokens?: unknown[] };
      if (typeof c.id !== 'number' || !chainById(c.id) || !Array.isArray(c.featuredTokens)) continue;
      const list = [nativeToken(chainById(c.id) as SwapChain)];
      for (const t of c.featuredTokens) {
        const token = fromRelayCurrency({ ...(t as object), chainId: c.id, metadata: { ...((t as { metadata?: object }).metadata ?? {}), verified: true } });
        if (token && !list.some((x) => sameToken(x, token))) list.push(token);
      }
      value.set(c.id, list.slice(0, 8));
    }
  } catch {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  }
  featuredCache = { base: ctx.relayBase, at: Date.now(), value };
  return value;
}

/** Searches by name, symbol or address. Falls back to reading an address on chain. */
export async function searchTokens(ctx: ProviderContext, chain: SwapChain, text: string, signal: AbortSignal): Promise<Token[]> {
  const term = text.trim().slice(0, 64);
  if (!term) return [];
  const byAddress = looksLikeAddress(chain, term);
  const body = byAddress
    ? { address: chain.vm === 'evm' ? term.toLowerCase() : term, chainIds: [chain.id], limit: 5 }
    : { term, chainIds: [chain.id], limit: 20, useExternalSearch: true };
  let found: Token[] = [];
  try {
    const { body: res } = await fetchJson('Relay', `${ctx.relayBase}/currencies/v2`, { method: 'POST', body, signal, timeoutMs: 10_000 });
    found = (Array.isArray(res) ? res : []).map(fromRelayCurrency).filter((t): t is Token => t !== null && t.chainId === chain.id);
  } catch {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  }
  if (found.length === 0 && byAddress) {
    const onchain = await lookupOnChain(chain, term, signal).catch(() => null);
    if (onchain) found = [onchain];
  }
  return found;
}

/** Reads a token's decimals (and for EVM its symbol and name) straight from the chain. */
export async function lookupOnChain(chain: SwapChain, address: string, signal?: AbortSignal): Promise<Token | null> {
  if (chain.vm === 'evm') {
    const client = createPublicClient({ transport: http(chain.rpc, { timeout: 10_000 }) });
    const token = address as Address;
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'TOKEN'),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => 'Unknown token'),
    ]);
    if (signal?.aborted) return null;
    return { chainId: chain.id, address, symbol: String(symbol).slice(0, 16), name: String(name).slice(0, 48), decimals: Number(decimals), verified: false };
  }
  // Jupiter's token list first: it names the token and is not rate limited like public RPCs.
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(address)}`, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    const list = res.ok ? ((await res.json()) as unknown) : null;
    const hit = Array.isArray(list) ? (list as Array<Record<string, unknown>>).find((t) => t?.id === address) : undefined;
    if (hit && typeof hit.decimals === 'number' && Number.isInteger(hit.decimals) && hit.decimals >= 0 && hit.decimals <= 18) {
      const icon = typeof hit.icon === 'string' && hit.icon.startsWith('https://') ? hit.icon : undefined;
      return {
        chainId: chain.id, address, decimals: hit.decimals,
        symbol: typeof hit.symbol === 'string' && hit.symbol ? hit.symbol.slice(0, 16) : `${address.slice(0, 4)}…${address.slice(-4)}`,
        name: typeof hit.name === 'string' && hit.name ? hit.name.slice(0, 48) : 'Unlisted token',
        logo: icon, verified: hit.isVerified === true,
      };
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  // Then the chain itself, through each public RPC in turn.
  for (const rpc of [chain.rpc, ...(chain.rpcFallback ? [chain.rpcFallback] : [])]) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [address] }),
        signal,
      });
      const json = (await res.json()) as { result?: { value?: { decimals?: unknown } } };
      const decimals = json.result?.value?.decimals;
      if (typeof decimals !== 'number') continue;
      const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
      return { chainId: chain.id, address, symbol: short, name: 'Unlisted token', decimals, verified: false };
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return null;
}
