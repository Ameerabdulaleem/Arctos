// The EVM side of the sniper wallet: one address that works on BNB Chain, Base, Ethereum and the
// other EVM chains, so the sniper can trade there without a wallet popup for every buy and sell.
//
// Same protection as the Solana side: the private key never leaves the browser, is stored
// encrypted with the user's password (PBKDF2 with SHA-256, then AES-GCM), and is decrypted only in
// memory after unlocking. Trades use the swap engine's routes (KyberSwap, 0x, Sushi), every plan
// passes the same safety check as a swap in the Trading Terminal, and approvals are for the exact
// amount only. Withdrawals go only to the address the page passes in: the user's connected wallet.

import { createPublicClient, createWalletClient, custom, erc20Abi, http, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { checkEvmPlan, getQuotes, loadProviderContext, providerById } from './aggregate';
import { balanceOf } from './balances';
import { CHAINS, chainByKey, isNative, txUrl, type SwapChain } from './chains';
import { ensureChain, walletMessage } from './execute';
import { emitSniperChange, MIN_PASSWORD, openSecret, sealSecret, solanaPasswordOk } from './sniperWallet';
import { lookupOnChain, nativeToken } from './tokens';
import type { Plan, QuoteRequest, Token } from './types';
import type { EvmWallet } from './wallets';

const STORE_KEY = 'arctos_sniper_evm_v1';

/** EVM chains the sniper wallet trades on: those the swap engine routes. */
export const SNIPER_EVM_CHAINS: SwapChain[] = CHAINS.filter((c) => c.vm === 'evm');

interface Stored {
  v: 1;
  address: string;
  salt: string;
  iv: string;
  data: string;
  createdAt: number;
  backedUp: boolean;
}

let unlocked: { address: Address; key: Hex } | null = null;

function read(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Stored | null;
    return s && s.v === 1 && /^0x[0-9a-fA-F]{40}$/.test(s.address) && typeof s.data === 'string' ? s : null;
  } catch {
    return null;
  }
}

function write(s: Stored) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

const hexOfBytes = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}` as Hex;
const bytesOfHex = (h: Hex) => Uint8Array.from(h.slice(2).match(/../g) ?? [], (x) => parseInt(x, 16));

export interface EvmSniperInfo {
  address: string;
  createdAt: number;
  backedUp: boolean;
  unlocked: boolean;
}

export function evmSniperInfo(): EvmSniperInfo | null {
  const s = read();
  return s ? { address: s.address, createdAt: s.createdAt, backedUp: s.backedUp, unlocked: unlocked?.address.toLowerCase() === s.address.toLowerCase() } : null;
}

/** The unlocked address, or null while locked. */
export function evmSniperAddress(): string | null {
  return unlocked?.address ?? null;
}

/**
 * Creates the EVM wallet and returns its private key once, for the user's backup. When a Solana
 * sniper wallet exists, the same password must open it, so one password unlocks both.
 */
export async function createEvmSniperWallet(password: string): Promise<{ address: string; secret: string }> {
  if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (read()) throw new Error('An EVM sniper wallet already exists in this browser.');
  if (!(await solanaPasswordOk(password))) throw new Error('Use the same password as your Solana sniper wallet, so one password unlocks both.');
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const sealed = await sealSecret(password, bytesOfHex(key));
  write({ v: 1, address: account.address, ...sealed, createdAt: Date.now(), backedUp: false });
  unlocked = { address: account.address, key };
  emitSniperChange();
  return { address: account.address, secret: key };
}

async function decrypt(password: string): Promise<{ address: Address; key: Hex }> {
  const s = read();
  if (!s) throw new Error('There is no EVM sniper wallet in this browser.');
  const key = hexOfBytes(await openSecret(password, s));
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== s.address.toLowerCase()) throw new Error('The stored wallet does not match its address.');
  return { address: account.address, key };
}

export async function unlockEvmSniper(password: string): Promise<void> {
  unlocked = await decrypt(password);
  emitSniperChange();
}

export function lockEvmSniper() {
  unlocked = null;
  emitSniperChange();
}

/** The private key in the 0x form MetaMask, Rabby and OKX import. Asks for the password again. */
export async function exportEvmSniperSecret(password: string): Promise<string> {
  return (await decrypt(password)).key;
}

export function markEvmBackedUp() {
  const s = read();
  if (s) write({ ...s, backedUp: true });
  emitSniperChange();
}

/** Removes the EVM wallet from this browser. Only after its funds were withdrawn or its key saved. */
export function forgetEvmSniper() {
  unlocked = null;
  localStorage.removeItem(STORE_KEY);
  emitSniperChange();
}

// ------------------------------------------------------------------ chain access

const readers = new Map<number, PublicClient>();
function reader(chain: SwapChain): PublicClient {
  let c = readers.get(chain.id);
  if (!c) {
    c = createPublicClient({ transport: http(chain.rpc, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
    readers.set(chain.id, c);
  }
  return c;
}

function signer(chain: SwapChain): { account: PrivateKeyAccount; client: ReturnType<typeof createWalletClient> } {
  if (!unlocked) throw new Error('Unlock the sniper wallet first.');
  const account = privateKeyToAccount(unlocked.key);
  return { account, client: createWalletClient({ account, transport: http(chain.rpc, { timeout: 20_000, retryCount: 1 }) }) };
}

/** Native coin kept back on each chain for network fees and approvals. */
export function evmReserve(chain: SwapChain): bigint {
  if (chain.id === 1) return 6_000_000_000_000_000n; // 0.006 ETH
  if (chain.id === 56) return 2_000_000_000_000_000n; // 0.002 BNB
  if (chain.id === 137 || chain.id === 146) return 300_000_000_000_000_000n; // 0.3 POL or S
  if (chain.id === 43114) return 50_000_000_000_000_000n; // 0.05 AVAX
  return 600_000_000_000_000n; // 0.0006 ETH on rollups
}

/** The wallet's native coin on a chain, or null when it could not be read. */
export async function evmSniperBalance(chain: SwapChain): Promise<bigint | null> {
  const s = read();
  return s ? balanceOf(nativeToken(chain), s.address) : null;
}

/** Sends native coin from the user's connected EVM wallet into the sniper wallet. */
export async function depositToEvmSniper(chain: SwapChain, wallet: EvmWallet, amount: bigint): Promise<string> {
  const s = read();
  if (!s) throw new Error('Create the EVM sniper wallet first.');
  if (amount <= 0n) throw new Error('Enter an amount to deposit.');
  try {
    await ensureChain(wallet.provider, chain);
    const client = createWalletClient({ account: wallet.address as Address, transport: custom(wallet.provider) });
    const hash = await client.sendTransaction({ to: s.address as Address, value: amount, chain: null });
    const receipt = await reader(chain).waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== 'success') throw new Error('The deposit failed on chain.');
    return txUrl(chain, hash);
  } catch (e) {
    throw new Error(walletMessage(e));
  }
}

/**
 * Sends native coin from the sniper wallet back to `to`, which the page takes from the user's
 * connected wallet. With no amount, everything is sent except the network fee.
 */
export async function withdrawFromEvmSniper(chain: SwapChain, to: string, amount?: bigint): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Connect the EVM wallet to withdraw to.');
  const { account, client } = signer(chain);
  const pub = reader(chain);
  const balance = await pub.getBalance({ address: account.address });
  const gas = 21_000n;
  const fees = await pub.estimateFeesPerGas().catch(() => null);
  const gasPrice = fees?.maxFeePerGas ?? fees?.gasPrice ?? (await pub.getGasPrice());
  const fee = (gas * gasPrice * 12n) / 10n;
  const value = amount ?? balance - fee;
  if (value <= 0n || value + fee > balance) throw new Error(`Not enough ${chain.native.symbol} in the sniper wallet for that and its network fee.`);
  const hash = await client.sendTransaction({
    account,
    to: to as Address,
    value,
    gas,
    ...(fees?.maxFeePerGas != null ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n } : { gasPrice }),
    chain: null,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('The withdrawal failed on chain.');
  return txUrl(chain, hash);
}

// ------------------------------------------------------------------ trading

export interface EvmFill {
  link: string;
  /** Spent and received, in each token's smallest unit. */
  spent: bigint;
  received: bigint;
  /** Native coin paid in network fees for the approval and the swap. */
  feeWei: bigint;
}

async function runLocal(chain: SwapChain, plan: Extract<Plan, { vm: 'evm' }>, req: QuoteRequest): Promise<EvmFill> {
  checkEvmPlan(plan, req);
  const { account, client } = signer(chain);
  const pub = reader(chain);
  const before = (await balanceOf(req.to, account.address)) ?? 0n;
  let feeWei = 0n;

  if (plan.approval) {
    const token = plan.approval.token as Address;
    const spender = plan.approval.spender as Address;
    const allowance = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, spender] });
    if (allowance < plan.approval.amount) {
      const hash = await client.writeContract({ account, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, plan.approval.amount], chain: null });
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== 'success') throw new Error('The approval failed on chain. Nothing was swapped.');
      feeWei += receipt.gasUsed * receipt.effectiveGasPrice;
    }
  }

  const hash = await client.sendTransaction({
    account,
    to: plan.tx.to as Address,
    data: plan.tx.data as Hex,
    value: plan.tx.value,
    ...(plan.tx.gas ? { gas: (plan.tx.gas * 13n) / 10n } : {}),
    chain: null,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  feeWei += receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.status !== 'success') throw new Error('The swap failed on chain, usually because the price moved past the slippage. Only the network fee was spent.');
  const after = (await balanceOf(req.to, account.address)) ?? before;
  // Selling for the native coin: the fees came out of the same balance, so they are added back.
  const received = isNative(chain, req.to.address) ? after - before + feeWei : after - before;
  return { link: txUrl(chain, hash), spent: req.amount, received: received > 0n ? received : 0n, feeWei };
}

/**
 * Swaps from the sniper wallet through the best route that builds a plain transaction (KyberSwap,
 * 0x, Sushi). Routes are tried best first; one that cannot build a safe plan is skipped.
 */
export async function evmSniperSwap(chain: SwapChain, from: Token, to: Token, amount: bigint, slippageBps: number): Promise<EvmFill> {
  const address = evmSniperAddress();
  if (!address) throw new Error('Unlock the sniper wallet first.');
  if (amount <= 0n) throw new Error('Nothing to trade.');
  const ctx = await loadProviderContext();
  const req: QuoteRequest = { from, to, amount, sender: address, recipient: address, slippageBps };
  const { quotes, failures } = await getQuotes(req, ctx, AbortSignal.timeout(20_000));
  let lastError: string | null = null;
  for (const q of quotes) {
    if (q.provider === 'squid' || q.provider === 'jupiter') continue;
    let plan: Plan;
    try {
      plan = await providerById(q.provider).plan(q, req, ctx, AbortSignal.timeout(20_000));
    } catch (e) {
      lastError = e instanceof Error ? e.message : null;
      continue;
    }
    if (plan.vm !== 'evm' || plan.track) continue;
    try {
      return await runLocal(chain, plan, req);
    } catch (e) {
      throw new Error(walletMessage(e));
    }
  }
  throw new Error(lastError ?? (failures[0] ? `${failures[0].provider}: ${failures[0].message}` : `No route on ${chain.name} for this token right now.`));
}

const tokens = new Map<string, Token>();
/** The token's details, read once from the chain. */
export async function evmToken(chain: SwapChain, address: string): Promise<Token> {
  const key = `${chain.id}:${address.toLowerCase()}`;
  const hit = tokens.get(key);
  if (hit) return hit;
  const t = await lookupOnChain(chain, address);
  if (!t) throw new Error('The token could not be read on chain.');
  tokens.set(key, t);
  return t;
}

export async function evmSniperBuy(chainKey: string, address: string, spendWei: bigint, slippageBps: number): Promise<EvmFill & { token: Token }> {
  const chain = chainByKey(chainKey);
  if (!chain || chain.vm !== 'evm') throw new Error('The EVM sniper wallet trades on EVM chains only.');
  const token = await evmToken(chain, address);
  return { ...(await evmSniperSwap(chain, nativeToken(chain), token, spendWei, slippageBps)), token };
}

export async function evmSniperSell(chainKey: string, address: string, raw: bigint, slippageBps: number): Promise<EvmFill> {
  const chain = chainByKey(chainKey);
  if (!chain || chain.vm !== 'evm') throw new Error('The EVM sniper wallet trades on EVM chains only.');
  return evmSniperSwap(chain, await evmToken(chain, address), nativeToken(chain), raw, slippageBps);
}

/** The sniper wallet's balance of a token, in its smallest unit. */
export async function evmSniperTokenBalance(chainKey: string, address: string): Promise<bigint | null> {
  const chain = chainByKey(chainKey);
  const owner = evmSniperAddress() ?? read()?.address;
  if (!chain || !owner) return null;
  return balanceOf(await evmToken(chain, address), owner);
}
