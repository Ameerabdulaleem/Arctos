// Small Solana JSON RPC client for the browser: each call tries the public RPCs in turn, since
// a single public endpoint often refuses or rate limits.

import { chainById, SOLANA_ID } from './chains';

// An endpoint that refuses or fails is skipped for a minute, so a long run of calls goes straight
// to one that answers.
const resting = new Map<string, number>();
const REST_MS = 60_000;

function endpoints(): string[] {
  const chain = chainById(SOLANA_ID);
  const all = chain ? [chain.rpc, ...(chain.rpcFallback ? [chain.rpcFallback] : [])] : [];
  const now = Date.now();
  const awake = all.filter((u) => (resting.get(u) ?? 0) <= now);
  return awake.length ? [...awake, ...all.filter((u) => !awake.includes(u))] : all;
}

export async function solanaCall<T>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  let last: unknown = new Error('Solana could not be reached.');
  for (const url of endpoints()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
        credentials: 'omit',
      });
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        resting.set(url, Date.now() + REST_MS);
        last = new Error(res.status === 429 ? 'Solana is busy right now, try again in a moment.' : 'A Solana endpoint refused the request.');
        continue;
      }
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) {
        last = new Error(json.error.message?.slice(0, 200) ?? 'Solana refused the request.');
        // A transaction the chain rejects is rejected everywhere: do not resend it.
        if (method === 'sendTransaction') throw last;
        continue;
      }
      if (json.result !== undefined) return json.result;
    } catch (e) {
      if (signal?.aborted || method === 'sendTransaction') throw e;
      resting.set(url, Date.now() + REST_MS);
      last = e;
    }
  }
  throw last;
}

export async function lamportsOf(address: string, signal?: AbortSignal): Promise<bigint> {
  const r = await solanaCall<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }], signal);
  return BigInt(r.value);
}

export async function latestBlockhash(): Promise<string> {
  const r = await solanaCall<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.value.blockhash;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Sends a signed transaction and waits until it is confirmed, or throws. Returns the signature. */
export async function sendAndConfirm(signed: Uint8Array, timeoutMs = 60_000): Promise<string> {
  const signature = await solanaCall<string>('sendTransaction', [toBase64(signed), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await solanaCall<{ value: Array<{ confirmationStatus?: string; err?: unknown } | null> }>('getSignatureStatuses', [[signature]]);
      const s = r.value[0];
      if (s?.err) throw new Error('The transaction failed on chain. Only the network fee was spent.');
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return signature;
    } catch (e) {
      if (e instanceof Error && /failed on chain/.test(e.message)) throw e;
    }
  }
  throw new Error(`Not confirmed yet. Check it on Solscan: ${signature}`);
}
