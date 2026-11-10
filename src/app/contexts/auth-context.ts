import { createContext, useContext } from 'react';
import type { WalletType, WalletChainKind } from '../services/walletService';

export interface User {
  authMethod: 'wallet' | 'email';
  email?: string;
  walletAddress?: string;
  walletType?: WalletType;
  walletKind?: WalletChainKind;
  chainId?: number | null;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isWalletConnected: boolean;
  connectWallet: (walletType: WalletType) => Promise<void>;
  disconnectWallet: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
