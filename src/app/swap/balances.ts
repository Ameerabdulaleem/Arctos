// Reads a wallet's balance of one token from a public RPC. Read only.

import { createPublicClient, erc20Abi, http, type Address } from 'viem';
import { chainById, isNative, SOL_MINT } from './chains';
import type { Token } from './types';

async function solanaRpc<T>(urls: string[], method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  let last: unknown = new Error('rpc error');
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
      });
      const json = (await res.json()) as { result?: T; error?: unknown };
      if (!json.error && json.result !== undefined) return json.result;
      last = new Error('rpc error');
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw last;
}

/** The balance in the token's smallest unit, or null when it could not be read. */
export async function balanceOf(token: Token, owner: string, signal?: AbortSignal): Promise<bigint | null> {
  const chain = chainById(token.chainId);
  if (!chain) return null;
  try {
    if (chain.vm === 'evm') {
      const client = createPublicClient({ transport: http(chain.rpc, { timeout: 10_000 }) });
      if (isNative(chain, token.address)) return await client.getBalance({ address: owner as Address });
      return await client.readContract({ address: token.address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Address] });
    }
    const rpcs = [chain.rpc, ...(chain.rpcFallback ? [chain.rpcFallback] : [])];
    if (token.address === SOL_MINT) {
      const r = await solanaRpc<{ value: number }>(rpcs, 'getBalance', [owner, { commitment: 'confirmed' }], signal);
      return BigInt(r.value);
    }
    const r = await solanaRpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }> }>(
      rpcs,
      'getTokenAccountsByOwner',
      [owner, { mint: token.address }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      signal,
    );
    return r.value.reduce((sum, acc) => {
      const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount;
      return typeof amount === 'string' && /^\d+$/.test(amount) ? sum + BigInt(amount) : sum;
    }, 0n);
  } catch {
    return null;
  }
}

/** Native coin kept back when the user presses Max, so the swap can still pay its network fee. */
export function gasReserve(token: Token): bigint {
  const chain = chainById(token.chainId);
  if (!chain || !isNative(chain, token.address)) return 0n;
  if (chain.vm === 'svm') return 10_000_000n; // 0.01 SOL, also covers new token account rent
  if (chain.id === 1) return 3_000_000_000_000_000n; // 0.003 ETH
  if (chain.id === 56) return 1_000_000_000_000_000n; // 0.001 BNB
  if (chain.id === 137 || chain.id === 146) return 100_000_000_000_000_000n; // 0.1 POL or S
  if (chain.id === 43114) return 20_000_000_000_000_000n; // 0.02 AVAX
  return 300_000_000_000_000n; // 0.0003 ETH on rollups
}
