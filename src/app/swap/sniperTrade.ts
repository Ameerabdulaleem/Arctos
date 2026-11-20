// Buys and sells from the sniper wallet through Jupiter, signed in the browser with no popup.
// Each trade fetches a fresh order and signs it at once, so it never expires on the way.

import { SOL_MINT } from './chains';
import { jupiterExpired } from './execute';
import { errorMessage, fetchJson, ProviderError } from './http';
import { JUPITER_BASE } from './providers/solana';
import { signWithSniper, sniperAddress } from './sniperWallet';

export interface SniperFill {
  signature: string;
  /** Spent, in the input token's smallest unit. */
  spent: bigint;
  /** Received, in the output token's smallest unit. */
  received: bigint;
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const big = (v: unknown): bigint | null => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

async function swapOnce(inputMint: string, outputMint: string, amount: bigint, slippageBps: number, taker: string): Promise<SniperFill | 'expired'> {
  const q = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), taker });
  const { body } = await fetchJson('Jupiter', `${JUPITER_BASE}/order?${q}`);
  const order = body as { transaction?: unknown; requestId?: unknown; errorMessage?: unknown; error?: unknown };
  if (typeof order.transaction !== 'string' || order.transaction.length < 100 || typeof order.requestId !== 'string') {
    throw new ProviderError('Jupiter', typeof order.errorMessage === 'string' ? order.errorMessage : errorMessage(body) ?? 'found no route for this token');
  }
  const signed = await signWithSniper(b64ToBytes(order.transaction));
  let res: Record<string, unknown>;
  try {
    const r = await fetchJson('Jupiter', `${JUPITER_BASE}/execute`, { method: 'POST', body: { signedTransaction: bytesToB64(signed), requestId: order.requestId }, timeoutMs: 60_000 });
    res = (r.body ?? {}) as Record<string, unknown>;
  } catch (e) {
    const b = (e instanceof ProviderError ? e.body : null) as Record<string, unknown> | null;
    if (jupiterExpired(b?.code, b?.error ?? (e as Error).message)) return 'expired';
    throw e;
  }
  if (res.status !== 'Success') {
    if (jupiterExpired(res.code, res.error)) return 'expired';
    throw new Error(typeof res.error === 'string' ? `The trade did not land: ${res.error.slice(0, 140)}` : 'The trade did not land.');
  }
  return {
    signature: typeof res.signature === 'string' ? res.signature : '',
    spent: big(res.totalInputAmount) ?? big(res.inputAmountResult) ?? amount,
    received: big(res.totalOutputAmount) ?? big(res.outputAmountResult) ?? 0n,
  };
}

/** Swaps from the sniper wallet, trying a fresh order once more if the first one ran out of time. */
export async function sniperSwap(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SniperFill> {
  const taker = sniperAddress();
  if (!taker) throw new Error('Unlock the sniper wallet first.');
  if (amount <= 0n) throw new Error('Nothing to trade.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const fill = await swapOnce(inputMint, outputMint, amount, slippageBps, taker);
    if (fill !== 'expired') return fill;
  }
  throw new Error('The price kept expiring. Nothing was traded.');
}

export const sniperBuy = (mint: string, lamports: bigint, slippageBps: number) => sniperSwap(SOL_MINT, mint, lamports, slippageBps);
export const sniperSell = (mint: string, raw: bigint, slippageBps: number) => sniperSwap(mint, SOL_MINT, raw, slippageBps);
