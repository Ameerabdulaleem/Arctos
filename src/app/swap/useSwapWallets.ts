import { useCallback, useEffect, useSyncExternalStore } from 'react';
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

// One store for the whole app, so a wallet connected on one page shows on every other page at
// once (the Trade Book, the dashboard, the sniper and the assistant), without a reload.
interface State {
  evm: EvmWallet | null;
  svm: SolanaWallet | null;
}
let state: State = { evm: null, svm: null };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
let detachEvm: (() => void) | null = null;
let detachSvm: (() => void) | null = null;

function setState(next: Partial<State>) {
  const prev = state;
  state = { ...state, ...next };
  if ('evm' in next && next.evm?.provider !== prev.evm?.provider) watchEvm(state.evm);
  if ('svm' in next && next.svm?.provider !== prev.svm?.provider) watchSvm(state.svm);
  listeners.forEach((l) => l());
}

// Follow account changes inside the wallets, so a quote is never signed by the wrong account.
function watchEvm(w: EvmWallet | null) {
  detachEvm?.();
  detachEvm = null;
  const p = w?.provider;
  if (!p?.on) return;
  const onAccounts = (accounts: unknown) => {
    const next = (accounts as string[] | undefined)?.[0];
    setState({ evm: state.evm && next ? { ...state.evm, address: next } : null });
  };
  p.on('accountsChanged', onAccounts);
  detachEvm = () => p.removeListener?.('accountsChanged', onAccounts);
}

function watchSvm(w: SolanaWallet | null) {
  detachSvm?.();
  detachSvm = null;
  const p = w?.provider;
  if (!p?.on) return;
  const onAccount = (pk: unknown) => {
    const next = (pk as { toString?: () => string } | null)?.toString?.();
    setState({ svm: state.svm && next ? { ...state.svm, address: next } : null });
  };
  const onDisconnect = () => setState({ svm: null });
  p.on('accountChanged', onAccount);
  p.on('disconnect', onDisconnect);
  detachSvm = () => {
    p.off?.('accountChanged', onAccount);
    p.off?.('disconnect', onDisconnect);
  };
}

// Quiet restores run once per kind of wallet, however many pages ask.
const restoring = new Set<string>();

/** The EVM and Solana wallets the app signs with. Restored quietly, never with a prompt. */
export function useSwapWallets() {
  const { user } = useAuth();
  const { evm, svm } = useSyncExternalStore(subscribe, snapshot, snapshot);

  // Quiet restore: the wallet the user signed in with, the last EVM wallet used here, and Phantom if it trusts this site.
  // Signing in with a wallet in the top bar tries again, so that wallet shows everywhere at once.
  const signedIn = user?.authMethod === 'wallet' ? user.walletAddress ?? '' : '';
  useEffect(() => {
    const signedInEvm = user?.authMethod === 'wallet' && user.walletKind === 'evm' ? user.walletType ?? null : null;
    const type = signedInEvm ?? readLastEvm();
    if (type && !restoring.has(`evm:${type}:${signedIn}`)) {
      restoring.add(`evm:${type}:${signedIn}`);
      void restoreEvm(type).then((w) => { if (w && !state.evm) setState({ evm: w }); });
    }
    if (!restoring.has(`svm:${signedIn}`)) {
      restoring.add(`svm:${signedIn}`);
      void connectSolana(true).then((w) => { if (w && !state.svm) setState({ svm: w }); });
    }
  }, [user?.authMethod, user?.walletKind, user?.walletType, signedIn]);

  const connectEvmWallet = useCallback(async (type: WalletType) => {
    const w = await connectEvm(type);
    saveLastEvm(type);
    setState({ evm: w });
    return w;
  }, []);

  const connectSolanaWallet = useCallback(async () => {
    const w = await connectSolana(false);
    setState({ svm: w });
    return w;
  }, []);

  const disconnect = useCallback((vm: 'evm' | 'svm') => {
    if (vm === 'evm') {
      saveLastEvm(null);
      setState({ evm: null });
    } else {
      setState({ svm: null });
    }
  }, []);

  return { evm, svm, connectEvmWallet, connectSolanaWallet, disconnect };
}

export type SwapWallets = ReturnType<typeof useSwapWallets>;
