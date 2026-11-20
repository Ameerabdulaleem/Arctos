import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { checkSigned } from './solanaSign';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decode58(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) n = n * 58n + BigInt(B58.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of text) { if (c !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function transfer(from: PublicKey): Uint8Array {
  const msg = new TransactionMessage({
    payerKey: from, recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: Keypair.generate().publicKey, lamports: 1000 })],
  }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}

describe('sniper wallet', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  const load = () => import('./sniperWallet');

  it('creates an encrypted wallet whose backup key restores it', async () => {
    const w = await load();
    await expect(w.createSniperWallet('short')).rejects.toThrow(/at least/);
    const { address, secret } = await w.createSniperWallet('correct horse battery');
    expect(Keypair.fromSecretKey(decode58(secret)).publicKey.toBase58()).toBe(address);
    const stored = localStorage.getItem('arctos_sniper_wallet_v1') ?? '';
    expect(stored).toContain(address);
    expect(stored).not.toContain(secret);
    expect(w.sniperWalletInfo()).toMatchObject({ address, unlocked: true, backedUp: false });
    await expect(w.createSniperWallet('another password')).rejects.toThrow(/already exists/);
  }, 20_000);

  it('locks, refuses a wrong password and exports only with the right one', async () => {
    const w = await load();
    const { address, secret } = await w.createSniperWallet('correct horse battery');
    w.lockSniperWallet();
    expect(w.sniperAddress()).toBeNull();
    await expect(w.unlockSniperWallet('wrong password')).rejects.toThrow(/Wrong password/);
    await w.unlockSniperWallet('correct horse battery');
    expect(w.sniperAddress()).toBe(address);
    await expect(w.exportSniperSecret('nope nope nope')).rejects.toThrow(/Wrong password/);
    expect(await w.exportSniperSecret('correct horse battery')).toBe(secret);
  }, 30_000);

  it('signs its own transactions and refuses those of other wallets', async () => {
    const w = await load();
    const { address } = await w.createSniperWallet('correct horse battery');
    const signed = await w.signWithSniper(transfer(new PublicKey(address)));
    expect(() => checkSigned(signed, address)).not.toThrow();
    await expect(w.signWithSniper(transfer(Keypair.generate().publicKey))).rejects.toThrow(/not for the sniper wallet/);
    w.lockSniperWallet();
    await expect(w.signWithSniper(transfer(new PublicKey(address)))).rejects.toThrow(/Unlock/);
  }, 20_000);
});
