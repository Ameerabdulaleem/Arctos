// Wallets for the swap panel. One EVM wallet and one Solana wallet can be connected at once,
// so a bridge between the two kinds of chain can be signed on one side and paid out on the other.

import { findEvmProvider, isValidAddress, WalletError, type WalletType } from '../services/walletService';
import type { Vm } from './chains';

export interface EvmWallet {
  vm: 'evm';
  type: WalletType;
  address: string;
  provider: Eip1193Provider;
}

export interface SolanaWallet {
  vm: 'svm';
  address: string;
  provider: SolanaProvider;
}

export type SwapWallet = EvmWallet | SolanaWallet;

function rejected(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  return code === 4001 || /reject|denied|cancel/i.test(String((error as Error)?.message));
}

export async function connectEvm(type: WalletType): Promise<EvmWallet> {
  const provider = await findEvmProvider(type);
  if (!provider) throw new WalletError('not_installed', 'That wallet was not found in this browser.');
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts?.[0];
    if (!address || !isValidAddress(address, 'evm')) throw new WalletError('invalid', 'The wallet returned an address we could not read.');
    return { vm: 'evm', type, address, provider };
  } catch (e) {
    if (e instanceof WalletError) throw e;
    throw rejected(e) ? new WalletError('rejected', 'You closed the wallet request.') : new WalletError('unknown', 'The wallet could not connect.');
  }
}

/** Reconnects without a prompt when the wallet already trusts this site. */
export async function restoreEvm(type: WalletType): Promise<EvmWallet | null> {
  const provider = await findEvmProvider(type);
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    const address = accounts?.[0];
    return address && isValidAddress(address, 'evm') ? { vm: 'evm', type, address, provider } : null;
  } catch {
    return null;
  }
}

export async function connectSolana(onlyIfTrusted = false): Promise<SolanaWallet | null> {
  const provider = window.phantom?.solana;
  if (!provider) {
    if (onlyIfTrusted) return null;
    throw new WalletError('not_installed', 'Phantom was not found in this browser.');
  }
  try {
    const resp = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
    const address = resp.publicKey.toString();
    if (!isValidAddress(address, 'solana')) throw new WalletError('invalid', 'Phantom returned an address we could not read.');
    return { vm: 'svm', address, provider };
  } catch (e) {
    if (onlyIfTrusted) return null;
    if (e instanceof WalletError) throw e;
    throw rejected(e) ? new WalletError('rejected', 'You closed the wallet request.') : new WalletError('unknown', 'Phantom could not connect.');
  }
}

export function walletFor(vm: Vm, wallets: { evm: EvmWallet | null; svm: SolanaWallet | null }): SwapWallet | null {
  return vm === 'evm' ? wallets.evm : wallets.svm;
}
