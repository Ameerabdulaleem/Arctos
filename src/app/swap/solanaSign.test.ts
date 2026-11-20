import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import fixtures from './__fixtures__/providers.json';
import { base58, checkSigned, parseTransaction } from './solanaSign';

const order = fixtures.jupiterOrderTx;
const unsigned = () => Uint8Array.from(atob(order.transaction), (c) => c.charCodeAt(0));

/** Fills the taker's signature slot, standing in for the wallet. */
function signAsWallet(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const slot = parseTransaction(out).signers.indexOf(order.taker);
  out.fill(7, 1 + slot * 64, 1 + (slot + 1) * 64);
  return out;
}

describe('reading Solana transaction bytes', () => {
  it('encodes base58 like web3.js', () => {
    expect(base58(new Uint8Array(32))).toBe('11111111111111111111111111111111');
    for (let i = 0; i < 20; i++) {
      const key = PublicKey.unique();
      expect(base58(key.toBytes())).toBe(key.toBase58());
    }
  });

  it('finds the signers of a real Jupiter order', () => {
    const bytes = unsigned();
    const parsed = parseTransaction(bytes);
    const tx = VersionedTransaction.deserialize(bytes);
    const expected = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58());
    expect(parsed.signers).toEqual(expected);
    expect(parsed.signers[0]).toBe(order.taker);
    expect(parsed.signatures).toHaveLength(expected.length);
  });

  it('refuses bytes that are not a transaction', () => {
    expect(() => parseTransaction(new Uint8Array([1, 2, 3]))).toThrow(/could not be read/);
    expect(() => parseTransaction(unsigned().subarray(0, 80))).toThrow(/could not be read/);
  });

  it('accepts only a result the wallet really signed', () => {
    expect(() => checkSigned(unsigned(), order.taker)).toThrow(/did not sign/);
    expect(() => checkSigned(signAsWallet(unsigned()), order.taker)).not.toThrow();
    expect(() => checkSigned(signAsWallet(unsigned()), '11111111111111111111111111111111')).toThrow(/did not sign/);
  });
});

describe('signing through the wallet', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Each case gets its own copy of the module, so wallets registered in one do not leak into the next.
  const fresh = async () => {
    vi.resetModules();
    return (await import('./solanaSign')).signSolanaTransaction;
  };

  it('uses the Wallet Standard when the wallet registers, with bytes in and bytes out', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => [{ signedTransaction: signAsWallet(transaction) }]);
    const account = { address: order.taker, publicKey: new PublicKey(order.taker).toBytes(), chains: ['solana:mainnet'], features: ['solana:signTransaction'] };
    const wallet = { name: 'Phantom', version: '1.0.0', icon: '', chains: ['solana:mainnet'], accounts: [account], features: { 'solana:signTransaction': { version: '1.0.0', signTransaction } } };
    // The wallet announces itself the way @wallet-standard/wallet does.
    target.addEventListener('wallet-standard:app-ready', (e) => (e as CustomEvent<{ register(w: unknown): void }>).detail.register(wallet));

    const legacy = { connect: vi.fn(), disconnect: vi.fn(), signTransaction: vi.fn() } as unknown as SolanaProvider;
    const sign = await fresh();
    const signed = await sign(legacy, order.taker, unsigned());

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(signTransaction.mock.calls[0][0]).toMatchObject({ account, chain: 'solana:mainnet' });
    expect((legacy.signTransaction as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(() => checkSigned(signed, order.taker)).not.toThrow();
  });

  it('never asks a wallet to sign a route built for someone else', async () => {
    vi.stubGlobal('window', new EventTarget());
    const legacy = { connect: vi.fn(), disconnect: vi.fn(), signTransaction: vi.fn() } as unknown as SolanaProvider;
    const sign = await fresh();
    await expect(sign(legacy, '11111111111111111111111111111111', unsigned())).rejects.toThrow(/another wallet/);
    expect((legacy.signTransaction as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('falls back to the injected API and explains an empty answer instead of crashing', async () => {
    vi.stubGlobal('window', new EventTarget());
    const empty = { connect: vi.fn(), disconnect: vi.fn(), signTransaction: vi.fn(async () => undefined) } as unknown as SolanaProvider;
    const sign = await fresh();
    await expect(sign(empty, order.taker, unsigned())).rejects.toThrow(/did not return the signed swap/);

    const working = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTransaction: vi.fn(async (tx: VersionedTransaction) => VersionedTransaction.deserialize(signAsWallet(tx.serialize()))),
    } as unknown as SolanaProvider;
    const signed = await sign(working, order.taker, unsigned());
    expect(() => checkSigned(signed, order.taker)).not.toThrow();
  });
});

describe('Jupiter expiry', () => {
  it('recognises an order that ran out of time', async () => {
    const { jupiterExpired } = await import('./execute');
    expect(jupiterExpired(-1, 'Missing cached order')).toBe(true);
    expect(jupiterExpired(undefined, 'Order not found, it might have expired.')).toBe(true);
    expect(jupiterExpired(-2003, null)).toBe(true);
    expect(jupiterExpired(-1000, 'Failed to land')).toBe(false);
    expect(jupiterExpired(-2004, 'Swap rejected')).toBe(false);
  });
});
