import { useMemo } from 'react';
import { useAuth } from '../contexts/auth-context';
import { useSwapWallets, type SwapWallets } from '../swap/useSwapWallets';

export interface ConnectedWallet {
  address: string;
  kind: 'evm' | 'solana';
}

/**
 * Every wallet this browser has connected: the one used to sign in, and the EVM and Solana
 * wallets connected in the swap panel. Those are restored quietly, never with a prompt, and
 * only public addresses are read.
 */
export function useConnectedWallets(): { wallets: ConnectedWallet[]; swap: SwapWallets } {
  const { user, isWalletConnected } = useAuth();
  const swap = useSwapWallets();
  const signedIn = isWalletConnected ? user?.walletAddress : undefined;
  const signedInKind = user?.walletKind;

  const wallets = useMemo(() => {
    const list: ConnectedWallet[] = [];
    const add = (address: string | undefined | null, kind: 'evm' | 'solana') => {
      if (!address) return;
      const key = kind === 'evm' ? address.toLowerCase() : address;
      if (list.some((w) => (w.kind === 'evm' ? w.address.toLowerCase() : w.address) === key)) return;
      list.push({ address, kind });
    };
    add(swap.svm?.address, 'solana');
    add(swap.evm?.address, 'evm');
    add(signedIn, signedInKind === 'solana' ? 'solana' : 'evm');
    return list;
  }, [swap.svm?.address, swap.evm?.address, signedIn, signedInKind]);

  return { wallets, swap };
}
