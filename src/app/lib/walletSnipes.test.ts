import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('sniper wallet settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('snipes on Solana and BNB Chain by default, with a BNB amount per buy', async () => {
    const { readWalletSettings } = await import('./walletSnipes');
    const s = readWalletSettings();
    expect(s.autoChains).toEqual(['solana', 'bsc']);
    expect(s.sniperSpendEvm.bsc).toBe('0.01');
  });

  it('keeps valid saved choices and drops anything else', async () => {
    localStorage.setItem('arctos_sniper_wallet_settings', JSON.stringify({
      autoChains: ['bsc', 'base', 'mars', 42], sniperSpendEvm: { bsc: '0.05', base: 'lots' },
    }));
    const { readWalletSettings } = await import('./walletSnipes');
    const s = readWalletSettings();
    expect(s.autoChains).toEqual(['bsc', 'base']);
    expect(s.sniperSpendEvm.bsc).toBe('0.05');
    expect(s.sniperSpendEvm.base).toBe('0.002');
  });

  it('never ends up with no chain to scan', async () => {
    localStorage.setItem('arctos_sniper_wallet_settings', JSON.stringify({ autoChains: ['mars'] }));
    const { readWalletSettings } = await import('./walletSnipes');
    expect(readWalletSettings().autoChains).toEqual(['solana', 'bsc']);
  });
});
