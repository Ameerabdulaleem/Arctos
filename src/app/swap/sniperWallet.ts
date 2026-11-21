// The sniper wallet: a Solana wallet that lives only in this browser, so the sniper can trade
// without a wallet popup for every buy and sell. The user funds it with a budget from their own
// wallet and withdraws back to it, so their main holdings are never in reach.
//
// Its secret key never leaves the browser. It is stored encrypted with the user's password
// (PBKDF2 with SHA-256, 310,000 rounds, then AES-GCM), and decrypted only in memory after the user
// unlocks it. Locking, or closing the page, forgets the decrypted key.

import { base58, parseTransaction } from './solanaSign';
import { latestBlockhash, lamportsOf, sendAndConfirm } from './solanaRpc';

const STORE_KEY = 'arctos_sniper_wallet_v1';
const ROUNDS = 310_000;
export const MIN_PASSWORD = 8;
/** Kept back for network fees and new token accounts (about 0.002 SOL each). */
export const SOL_RESERVE = 20_000_000n;
const FEE = 5_000n;

interface Stored {
  v: 1;
  address: string;
  salt: string;
  iv: string;
  data: string;
  createdAt: number;
  backedUp: boolean;
}

type Web3 = typeof import('@solana/web3.js');
let web3: Promise<Web3> | null = null;
const loadWeb3 = () => (web3 ??= import('@solana/web3.js'));

let unlocked: { address: string; secret: Uint8Array } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function onSniperWalletChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function read(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Stored | null;
    return s && s.v === 1 && typeof s.address === 'string' && typeof s.data === 'string' ? s : null;
  } catch {
    return null;
  }
}

function write(s: Stored) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}

async function aesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypts secret bytes with a password, the same way the Solana key is kept. */
export async function sealSecret(password: string, bytes: Uint8Array): Promise<{ salt: string; iv: string; data: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(password, salt), bytes as BufferSource));
  return { salt: b64(salt), iv: b64(iv), data: b64(data) };
}

/** Decrypts what `sealSecret` made. Throws "Wrong password." when the password does not open it. */
export async function openSecret(password: string, sealed: { salt: string; iv: string; data: string }): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, await aesKey(password, unb64(sealed.salt)), unb64(sealed.data) as BufferSource));
  } catch {
    throw new Error('Wrong password.');
  }
}

/** Tells every listener that a sniper wallet changed (created, unlocked, locked or removed). */
export function emitSniperChange() {
  emit();
}

/** True when the password opens the stored Solana sniper wallet, or when there is none. */
export async function solanaPasswordOk(password: string): Promise<boolean> {
  if (!read()) return true;
  try {
    await decrypt(password);
    return true;
  } catch {
    return false;
  }
}

export interface SniperWalletInfo {
  address: string;
  createdAt: number;
  backedUp: boolean;
  unlocked: boolean;
}

export function sniperWalletInfo(): SniperWalletInfo | null {
  const s = read();
  return s ? { address: s.address, createdAt: s.createdAt, backedUp: s.backedUp, unlocked: unlocked?.address === s.address } : null;
}

/** Creates the wallet, stores it encrypted, and returns its secret key once, for the user's backup. */
export async function createSniperWallet(password: string): Promise<{ address: string; secret: string }> {
  if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (read()) throw new Error('A sniper wallet already exists in this browser.');
  const { Keypair } = await loadWeb3();
  const kp = Keypair.generate();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(password, salt), kp.secretKey as BufferSource));
  const address = kp.publicKey.toBase58();
  write({ v: 1, address, salt: b64(salt), iv: b64(iv), data: b64(data), createdAt: Date.now(), backedUp: false });
  unlocked = { address, secret: kp.secretKey };
  emit();
  return { address, secret: base58(kp.secretKey) };
}

async function decrypt(password: string): Promise<{ address: string; secret: Uint8Array }> {
  const s = read();
  if (!s) throw new Error('There is no sniper wallet in this browser.');
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) as BufferSource }, await aesKey(password, unb64(s.salt)), unb64(s.data) as BufferSource));
  } catch {
    throw new Error('Wrong password.');
  }
  const { Keypair } = await loadWeb3();
  if (Keypair.fromSecretKey(secret).publicKey.toBase58() !== s.address) throw new Error('The stored wallet does not match its address.');
  return { address: s.address, secret };
}

export async function unlockSniperWallet(password: string): Promise<void> {
  unlocked = await decrypt(password);
  emit();
}

export function lockSniperWallet() {
  if (unlocked) unlocked.secret.fill(0);
  unlocked = null;
  emit();
}

/** The secret key in the base58 form Phantom and Solflare import. Asks for the password again. */
export async function exportSniperSecret(password: string): Promise<string> {
  const { secret } = await decrypt(password);
  return base58(secret);
}

export function markBackedUp() {
  const s = read();
  if (s) write({ ...s, backedUp: true });
  emit();
}

/** Removes the wallet from this browser. Only call after its funds were withdrawn or its key exported. */
export function forgetSniperWallet() {
  lockSniperWallet();
  localStorage.removeItem(STORE_KEY);
  emit();
}

export function sniperAddress(): string | null {
  return unlocked?.address ?? null;
}

/** Signs a serialized transaction with the sniper wallet. Refuses one it is not asked to sign. */
export async function signWithSniper(bytes: Uint8Array): Promise<Uint8Array> {
  if (!unlocked) throw new Error('Unlock the sniper wallet first.');
  if (!parseTransaction(bytes).signers.includes(unlocked.address)) throw new Error('That transaction is not for the sniper wallet.');
  const { Keypair, VersionedTransaction } = await loadWeb3();
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([Keypair.fromSecretKey(unlocked.secret)]);
  return tx.serialize();
}

async function transferBytes(from: string, to: string, lamports: bigint): Promise<Uint8Array> {
  const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = await loadWeb3();
  const message = new TransactionMessage({
    payerKey: new PublicKey(from),
    recentBlockhash: await latestBlockhash(),
    instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

export async function sniperBalance(): Promise<bigint | null> {
  const s = read();
  return s ? lamportsOf(s.address) : null;
}

/** Moves SOL from the user's wallet into the sniper wallet. `sign` is the user's own wallet. */
export async function depositToSniper(from: string, lamports: bigint, sign: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const s = read();
  if (!s) throw new Error('Create the sniper wallet first.');
  if (lamports <= 0n) throw new Error('Enter an amount to deposit.');
  const bytes = await transferBytes(from, s.address, lamports);
  return sendAndConfirm(await sign(bytes));
}

/**
 * Sends SOL from the sniper wallet back to the user's wallet. With no amount, everything is sent
 * except the fee. The destination is always the address passed in, which the page takes from the
 * user's connected wallet.
 */
export async function withdrawFromSniper(to: string, lamports?: bigint): Promise<string> {
  if (!unlocked) throw new Error('Unlock the sniper wallet first.');
  const balance = await lamportsOf(unlocked.address);
  const amount = lamports ?? balance - FEE;
  if (amount <= 0n || amount + FEE > balance) throw new Error('Not enough SOL in the sniper wallet for that.');
  const bytes = await transferBytes(unlocked.address, to, amount);
  return sendAndConfirm(await signWithSniper(bytes));
}
