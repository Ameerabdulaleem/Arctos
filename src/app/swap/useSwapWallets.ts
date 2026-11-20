import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/auth-context';
import type { WalletType } from '../services/walletService';
import { connectEvm, connectSolana, restoreEvm, type EvmWallet, type SolanaWallet } from './wallets';

const LAST_EVM = 'arctos_swap_evm_wallet';
const EVM_TYPES: WalletType[] = ['metamask', 'rabby', 'okx', 'phantom'];

function readLastEvm(): WalletType | null {
  try {
    const v = localStorage.getItem(LAST_EVM);
    return v && (EVM_TYPES as string[]).includes(v) ? (v as WalletType) : null;
  } catch {
    return null;
  }
}

function saveLastEvm(type: WalletType | null) {
  try {
    if (type) localStorage.setItem(LAST_EVM, type);
    else localStorage.removeItem(LAST_EVM);
  } catch {
    /* storage blocked */
  }
}

/** The EVM and Solana wallets the swap panel signs with. Restored quietly, never with a prompt. */
export function useSwapWallets() {
  const { user } = useAuth();
  const [evm, setEvm] = useState<EvmWallet | null>(null);
  const [svm, setSvm] = useState<SolanaWallet | null>(null);

  // Quiet restore: the wallet the user signed in with, the last EVM wallet used here, and Phantom if it trusts this site.
  useEffect(() => {
    let live = true;
    const signedInEvm = user?.authMethod === 'wallet' && user.walletKind === 'evm' ? user.walletType ?? null : null;
    const type = signedInEvm ?? readLastEvm();
    if (type) void restoreEvm(type).then((w) => live && w && setEvm((cur) => cur ?? w));
    void connectSolana(true).then((w) => live && w && setSvm((cur) => cur ?? w));
    return () => {
      live = false;
    };
  }, [user?.authMethod, user?.walletKind, user?.walletType]);

  // Follow account changes inside the wallets, so a quote is never signed by the wrong account.
  useEffect(() => {
    const p = evm?.provider;
    if (!p?.on) return;
    const onAccounts = (accounts: unknown) => {
      const next = (accounts as string[] | undefined)?.[0];
      setEvm((cur) => (cur && next ? { ...cur, address: next } : null));
    };
    p.on('accountsChanged', onAccounts);
    return () => p.removeListener?.('accountsChanged', onAccounts);
  }, [evm?.provider]);

  useEffect(() => {
    const p = svm?.provider;
    if (!p?.on) return;
    const onAccount = (pk: unknown) => {
      const next = (pk as { toString?: () => string } | null)?.toString?.();
      setSvm((cur) => (cur && next ? { ...cur, address: next } : null));
    };
    const onDisconnect = () => setSvm(null);
    p.on('accountChanged', onAccount);
    p.on('disconnect', onDisconnect);
    return () => {
      p.off?.('accountChanged', onAccount);
      p.off?.('disconnect', onDisconnect);
    };
  }, [svm?.provider]);

  const connectEvmWallet = useCallback(async (type: WalletType) => {
    const w = await connectEvm(type);
    saveLastEvm(type);
    setEvm(w);
    return w;
  }, []);

  const connectSolanaWallet = useCallback(async () => {
    const w = await connectSolana(false);
    setSvm(w);
    return w;
  }, []);

  const disconnect = useCallback((vm: 'evm' | 'svm') => {
    if (vm === 'evm') {
      saveLastEvm(null);
      setEvm(null);
    } else {
      setSvm(null);
    }
  }, []);

  return { evm, svm, connectEvmWallet, connectSolanaWallet, disconnect };
}

export type SwapWallets = ReturnType<typeof useSwapWallets>;
