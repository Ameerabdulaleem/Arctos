import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('EVM sniper wallet', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  const load = async () => ({ evm: await import('./sniperEvm'), sol: await import('./sniperWallet') });

  it('creates an encrypted wallet whose exported key controls its address', async () => {
    const { evm } = await load();
    await expect(evm.createEvmSniperWallet('short')).rejects.toThrow(/at least/);
    const made = await evm.createEvmSniperWallet('correct horse');
    expect(made.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(privateKeyToAccount(made.secret as `0x${string}`).address).toBe(made.address);
    // Nothing secret is stored in the clear.
    const stored = localStorage.getItem('arctos_sniper_evm_v1') ?? '';
    expect(stored).not.toContain(made.secret.slice(2));
    expect(evm.evmSniperInfo()?.unlocked).toBe(true);
    await expect(evm.createEvmSniperWallet('correct horse')).rejects.toThrow(/already exists/);
  });

  it('locks, refuses a wrong password, and unlocks with the right one', async () => {
    const { evm } = await load();
    const made = await evm.createEvmSniperWallet('correct horse');
    evm.lockEvmSniper();
    expect(evm.evmSniperAddress()).toBeNull();
    await expect(evm.unlockEvmSniper('wrong password')).rejects.toThrow(/Wrong password/);
    await evm.unlockEvmSniper('correct horse');
    expect(evm.evmSniperAddress()).toBe(made.address);
    expect(await evm.exportEvmSniperSecret('correct horse')).toBe(made.secret);
  });

  it('uses the Solana sniper wallet password, so one password unlocks both', async () => {
    const { evm, sol } = await load();
    await sol.createSniperWallet('solana password');
    await expect(evm.createEvmSniperWallet('another password')).rejects.toThrow(/same password/);
    const made = await evm.createEvmSniperWallet('solana password');
    expect(made.address).toMatch(/^0x/);
  });

  it('keeps back enough for fees on each chain', async () => {
    const { evm } = await load();
    const bsc = evm.SNIPER_EVM_CHAINS.find((c) => c.key === 'bsc');
    expect(bsc).toBeTruthy();
    expect(evm.evmReserve(bsc!)).toBe(2_000_000_000_000_000n);
  });
});
