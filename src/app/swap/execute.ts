// Runs a checked plan in the user's own wallet: approval if needed, then the swap, then
// tracking until the funds arrive. Every step is a wallet prompt the user can refuse.

import { createPublicClient, createWalletClient, custom, erc20Abi, numberToHex, type Address, type Hex } from 'viem';
import { API_BASE } from '../services/api';
import { checkEvmPlan } from './aggregate';
import { chainById, SOLANA_ID, txUrl, type SwapChain } from './chains';
import { fetchJson, ProviderError } from './http';
import { JUPITER_BASE } from './providers/solana';
import type { Plan, ProviderContext, QuoteRequest } from './types';
import { signSolanaTransaction } from './solanaSign';
import type { EvmWallet, SolanaWallet } from './wallets';

export type StepState = 'waiting' | 'active' | 'done' | 'failed';

export interface ExecStep {
  key: string;
  label: string;
  state: StepState;
  link?: string;
}

export interface ExecResult {
  /** The transaction on the source chain. */
  link: string | null;
  /** True once the output is confirmed in the receiving wallet. */
  delivered: boolean;
  note?: string;
}

type OnSteps = (steps: ExecStep[]) => void;

class Steps {
  private list: ExecStep[];
  constructor(private readonly emit: OnSteps, labels: Array<[string, string]>) {
    this.list = labels.map(([key, label]) => ({ key, label, state: 'waiting' }));
    this.emit([...this.list]);
  }
  set(key: string, state: StepState, link?: string) {
    this.list = this.list.map((s) => (s.key === key ? { ...s, state, link: link ?? s.link } : s));
    this.emit([...this.list]);
  }
  replace(list: ExecStep[]) {
    this.list = list;
    this.emit([...this.list]);
  }
  failActive() {
    this.list = this.list.map((s) => (s.state === 'active' ? { ...s, state: 'failed' } : s));
    this.emit([...this.list]);
  }
}

export function walletMessage(error: unknown): string {
  const code = (error as { code?: number })?.code;
  const msg = String((error as Error)?.message ?? '');
  if (code === 4001 || /user rejected|user denied|rejected the request|cancel/i.test(msg)) return 'You declined in the wallet. Nothing was sent.';
  if (/insufficient funds/i.test(msg)) return 'The wallet does not have enough to pay for this and its network fee.';
  if (error instanceof ProviderError) return `${error.provider} ${error.message}.`;
  return msg ? msg.slice(0, 200) : 'The wallet could not complete this step.';
}

// ------------------------------------------------------------------ EVM

export async function ensureChain(provider: Eip1193Provider, chain: SwapChain): Promise<void> {
  const current = parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
  if (current === chain.id) return;
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    const code = (e as { code?: number })?.code ?? (e as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
    if (code !== 4902) throw e;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: chain.name, nativeCurrency: chain.native, rpcUrls: [chain.rpc], blockExplorerUrls: [chain.explorer] }],
    });
  }
  const after = parseInt(String(await provider.request({ method: 'eth_chainId' })), 16);
  if (after !== chain.id) throw new Error(`Switch the wallet to ${chain.name} and try again.`);
}

/** Tokens that refuse a new approval while an old one is still open. */
const RESET_FIRST = new Set(['1:0xdac17f958d2ee523a2206206994597c13d831ec7']);

async function runEvm(plan: Extract<Plan, { vm: 'evm' }>, req: QuoteRequest, wallet: EvmWallet, emit: OnSteps): Promise<ExecResult> {
  checkEvmPlan(plan, req);
  const chain = chainById(plan.chainId) as SwapChain;
  const account = wallet.address as Address;
  const steps = new Steps(emit, [
    ['network', `Use ${chain.name} in your wallet`],
    ...(plan.approval ? ([['approve', `Approve exactly ${req.from.symbol} for this swap`]] as Array<[string, string]>) : []),
    ['swap', plan.track ? 'Send the bridge transaction' : 'Confirm the swap'],
    ...(plan.track ? ([['deliver', `Wait for ${req.to.symbol} on ${chainById(req.to.chainId)?.name ?? 'the other chain'}`]] as Array<[string, string]>) : []),
  ]);
  try {
    steps.set('network', 'active');
    await ensureChain(wallet.provider, chain);
    steps.set('network', 'done');

    const transport = custom(wallet.provider);
    const reader = createPublicClient({ transport });
    const signer = createWalletClient({ account, transport });

    if (plan.approval) {
      steps.set('approve', 'active');
      const token = plan.approval.token as Address;
      const spender = plan.approval.spender as Address;
      const allowance = await reader.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account, spender] });
      if (allowance < plan.approval.amount) {
        if (allowance > 0n && RESET_FIRST.has(`${chain.id}:${token.toLowerCase()}`)) {
          const reset = await signer.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, 0n], chain: null });
          await reader.waitForTransactionReceipt({ hash: reset, timeout: 180_000 });
        }
        const hash = await signer.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, plan.approval.amount], chain: null });
        steps.set('approve', 'active', txUrl(chain, hash));
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180_000 });
        if (receipt.status !== 'success') throw new Error('The approval failed on chain. Nothing was swapped.');
      }
      steps.set('approve', 'done');
    }

    steps.set('swap', 'active');
    const hash = await signer.sendTransaction({
      to: plan.tx.to as Address,
      data: plan.tx.data as Hex,
      value: plan.tx.value,
      ...(plan.tx.gas ? { gas: (plan.tx.gas * 12n) / 10n } : {}),
      chain: null,
    });
    const link = txUrl(chain, hash);
    steps.set('swap', 'active', link);
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 300_000 });
    if (receipt.status !== 'success') throw new Error('The transaction failed on chain, usually because the price moved past your slippage. Only the network fee was spent.');
    steps.set('swap', 'done');

    if (!plan.track) return { link, delivered: true };
    steps.set('deliver', 'active');
    const outcome = await trackSquid(plan.track, hash);
    steps.set('deliver', outcome.delivered ? 'done' : 'failed');
    return { link, delivered: outcome.delivered, note: outcome.note };
  } catch (e) {
    steps.failActive();
    throw new Error(walletMessage(e));
  }
}

async function trackSquid(track: NonNullable<Extract<Plan, { vm: 'evm' }>['track']>, hash: string): Promise<{ delivered: boolean; note?: string }> {
  const q = new URLSearchParams({ transactionId: hash, fromChainId: track.fromChain, toChainId: track.toChain, quoteId: track.quoteId });
  if (track.requestId) q.set('requestId', track.requestId);
  const until = Date.now() + 30 * 60_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 6_000));
    try {
      const { body } = await fetchJson('Squid', `${API_BASE}/api/squid/v2/status?${q}`, { timeoutMs: 10_000 });
      const status = (body as { squidTransactionStatus?: unknown })?.squidTransactionStatus;
      if (status === 'success') return { delivered: true };
      if (status === 'partial_success') return { delivered: false, note: 'The bridge finished but the last swap did not, so you received the bridged token instead.' };
      if (status === 'needs_gas') return { delivered: false, note: 'The bridge needs more gas on the other chain. Open the transaction on Axelarscan to add it.' };
      if (status === 'refund') return { delivered: false, note: 'The route failed and the funds were refunded on the source chain.' };
    } catch {
      // Not indexed yet, keep waiting.
    }
  }
  return { delivered: false, note: 'Still on its way. Check the transaction link for progress.' };
}

// ------------------------------------------------------------------ Solana (Jupiter)

/** The firm price ran out before the signed swap reached Jupiter. Nothing was swapped. */
export class QuoteExpiredError extends Error {
  constructor() {
    super('The price expired while your wallet was open, so nothing was swapped. A fresh price is ready, confirm again to sign it.');
    this.name = 'QuoteExpiredError';
  }
}

// Jupiter /execute codes that mean the order or its transaction ran out of time.
const EXPIRED_CODES = new Set([-1, -1004, -1005, -2003]);

export function jupiterExpired(code: unknown, text: unknown): boolean {
  return (typeof code === 'number' && EXPIRED_CODES.has(code)) || (typeof text === 'string' && /not found|expired|block ?height/i.test(text));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function runJupiter(plan: Extract<Plan, { vm: 'svm' }>, wallet: SolanaWallet, emit: OnSteps): Promise<ExecResult> {
  const chain = chainById(SOLANA_ID) as SwapChain;
  const steps = new Steps(emit, [['sign', 'Sign the swap in your wallet'], ['land', 'Wait for Solana to confirm']]);
  try {
    steps.set('sign', 'active');
    const signed = await signSolanaTransaction(wallet.provider, wallet.address, base64ToBytes(plan.transaction));
    steps.set('sign', 'done');
    steps.set('land', 'active');
    let res: { status?: unknown; signature?: unknown; error?: unknown; code?: unknown };
    try {
      const { body } = await fetchJson('Jupiter', `${JUPITER_BASE}/execute`, {
        method: 'POST',
        body: { signedTransaction: bytesToBase64(signed), requestId: plan.requestId },
        timeoutMs: 60_000,
      });
      res = (body ?? {}) as typeof res;
    } catch (e) {
      const b = (e instanceof ProviderError ? e.body : null) as { code?: unknown; error?: unknown } | null;
      if (jupiterExpired(b?.code, b?.error ?? (e as Error).message)) throw new QuoteExpiredError();
      throw e;
    }
    const link = typeof res.signature === 'string' ? txUrl(chain, res.signature) : null;
    if (res.status !== 'Success') {
      steps.set('land', 'failed', link ?? undefined);
      if (jupiterExpired(res.code, res.error)) throw new QuoteExpiredError();
      throw new Error(typeof res.error === 'string' ? `The swap did not land: ${res.error.slice(0, 160)}` : 'The swap did not land. Nothing was swapped.');
    }
    steps.set('land', 'done', link ?? undefined);
    return { link, delivered: true };
  } catch (e) {
    steps.failActive();
    if (e instanceof QuoteExpiredError) throw e;
    throw new Error(walletMessage(e));
  }
}

// ------------------------------------------------------------------ Relay

type RelaySdk = typeof import('@relayprotocol/relay-sdk');
let relayReady: { base: string; sdk: Promise<RelaySdk> } | null = null;

/** Relay's SDK with its chain list, loaded once per API base and shared by every caller. */
function relayClient(ctx: ProviderContext): Promise<RelaySdk> {
  if (relayReady?.base !== ctx.relayBase) {
    const sdk = (async () => {
      const [mod, { fetchChainConfigs }] = await Promise.all([import('@relayprotocol/relay-sdk'), import('@relayprotocol/relay-sdk/chain-utils')]);
      const chains = await fetchChainConfigs(ctx.relayBase);
      mod.createClient({ baseApiUrl: ctx.relayBase, chains });
      return mod;
    })();
    const entry = { base: ctx.relayBase, sdk };
    relayReady = entry;
    sdk.catch(() => {
      if (relayReady === entry) relayReady = null;
    });
  }
  return relayReady!.sdk;
}

/** Loads Relay's SDK and chain list before the click, so its wallet prompt opens straight away. */
export function warmRelay(ctx: ProviderContext, fromSolana: boolean): void {
  relayClient(ctx).catch(() => {});
  if (fromSolana) void Promise.all([import('@relayprotocol/relay-svm-wallet-adapter'), import('@solana/web3.js')]).catch(() => {});
}

async function runRelay(plan: Extract<Plan, { vm: 'relay' }>, req: QuoteRequest, ctx: ProviderContext, wallet: EvmWallet | SolanaWallet, emit: OnSteps): Promise<ExecResult> {
  const from = chainById(req.from.chainId) as SwapChain;
  const steps = new Steps(emit, [['prepare', 'Prepare the route']]);
  try {
    steps.set('prepare', 'active');
    const sdk = await relayClient(ctx);
    let adapted;
    if (wallet.vm === 'evm') {
      await ensureChain(wallet.provider, from);
      adapted = sdk.adaptViemWallet(createWalletClient({ account: wallet.address as Address, transport: custom(wallet.provider) }));
    } else {
      const sol = wallet.provider;
      if (!sol.signAndSendTransaction) throw new Error('This wallet cannot send Solana transactions.');
      const [{ adaptSolanaWallet }, { Connection }] = await Promise.all([import('@relayprotocol/relay-svm-wallet-adapter'), import('@solana/web3.js')]);
      adapted = adaptSolanaWallet(wallet.address, SOLANA_ID, new Connection(from.rpc, 'confirmed'), async (tx) => {
        const r = await sol.signAndSendTransaction!(tx);
        return { signature: r.signature };
      });
    }
    steps.set('prepare', 'done');
    let link: string | null = null;
    const result = await sdk.getClient().actions.execute({
      quote: plan.quote as Parameters<ReturnType<typeof sdk.getClient>['actions']['execute']>[0]['quote'],
      wallet: adapted,
      onProgress: ({ steps: relaySteps, txHashes }) => {
        const first = txHashes?.[0];
        if (first) {
          const c = chainById(first.chainId);
          if (c) link = txUrl(c, first.txHash);
        }
        steps.replace([
          { key: 'prepare', label: 'Prepare the route', state: 'done' },
          ...(relaySteps ?? []).map((s, i) => {
            const items = s.items ?? [];
            const done = items.length > 0 && items.every((it) => it.status === 'complete');
            const started = items.some((it) => it.status === 'complete' || (it as { txHashes?: unknown[] }).txHashes?.length);
            return { key: `relay-${i}`, label: s.action || s.description || 'Relay step', state: (done ? 'done' : started ? 'active' : 'waiting') as StepState, link: i === 0 && link ? link : undefined };
          }),
        ]);
      },
    });
    const failed = (result.data as { error?: unknown }).error;
    if (failed) throw new Error('Relay could not complete the route. If anything was sent, Relay refunds it.');
    return { link, delivered: true };
  } catch (e) {
    steps.failActive();
    throw new Error(walletMessage(e));
  }
}

// ------------------------------------------------------------------ entry point

export async function runPlan(
  plan: Plan,
  req: QuoteRequest,
  ctx: ProviderContext,
  wallets: { evm: EvmWallet | null; svm: SolanaWallet | null },
  emit: OnSteps,
): Promise<ExecResult> {
  const from = chainById(req.from.chainId);
  if (!from) throw new Error('This chain is not supported.');
  const wallet = from.vm === 'evm' ? wallets.evm : wallets.svm;
  if (!wallet) throw new Error(`Connect a ${from.vm === 'evm' ? 'EVM' : 'Solana'} wallet first.`);
  if (req.sender && wallet.address !== req.sender) throw new Error('The connected wallet changed. Get a fresh quote.');
  if (plan.vm === 'evm') {
    if (wallet.vm !== 'evm') throw new Error('Connect an EVM wallet for this chain.');
    return runEvm(plan, req, wallet, emit);
  }
  if (plan.vm === 'svm') {
    if (wallet.vm !== 'svm') throw new Error('Connect Phantom for Solana.');
    return runJupiter(plan, wallet, emit);
  }
  return runRelay(plan, req, ctx, wallet, emit);
}
