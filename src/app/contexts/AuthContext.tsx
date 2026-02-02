import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { walletService, WalletConnection } from '../services/walletService';

export type WalletType = 'metamask' | 'phantom' | 'rabby' | 'nightly' | 'okx' | null;

interface User {
  email?: string;
  walletAddress?: string;
  walletType?: WalletType;
  authMethod: 'wallet' | 'email';
  chainId?: number;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isWalletConnected: boolean;
  connectWallet: (walletType: WalletType) => Promise<void>;
  disconnectWallet: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  availableWallets: {
    metamask: boolean;
    phantom: boolean;
    rabby: boolean;
    okx: boolean;
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [availableWallets, setAvailableWallets] = useState({
    metamask: false,
    phantom: false,
    rabby: false,
    okx: false
  });

  // Check available wallets on mount
  useEffect(() => {
    setAvailableWallets({
      metamask: walletService.isMetaMaskAvailable(),
      phantom: walletService.isPhantomAvailable(),
      rabby: walletService.isRabbyAvailable(),
      okx: walletService.isOKXAvailable()
    });
  }, []);

  // Load user from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('arctos_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // Save user to localStorage whenever it changes
  useEffect(() => {
    if (user) {
      localStorage.setItem('arctos_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('arctos_user');
    }
  }, [user]);

  const connectWallet = async (walletType: WalletType): Promise<void> => {
    if (!walletType) throw new Error('Wallet type is required');

    let connection: WalletConnection;
    
    try {
      switch (walletType) {
        case 'metamask':
          connection = await walletService.connectMetaMask();
          break;
        case 'phantom':
          connection = await walletService.connectPhantom();
          break;
        case 'rabby':
          connection = await walletService.connectRabby();
          break;
        case 'okx':
          connection = await walletService.connectOKX();
          break;
        default:
          throw new Error(`Unsupported wallet type: ${walletType}`);
      }

      setUser({
        walletAddress: connection.address,
        walletType: connection.walletType,
        authMethod: 'wallet',
        chainId: connection.chainId
      });

    } catch (error) {
      console.error('Wallet connection failed:', error);
      throw error;
    }
  };

  const disconnectWallet = () => {
    if (user?.authMethod === 'wallet') {
      setUser(null);
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<void> => {
    // In development mode, allow any email/password
    if (import.meta.env.VITE_APP_MOCK_MODE === 'true') {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock validation for development
      const savedAccounts = JSON.parse(localStorage.getItem('arctos_accounts') || '{}');
      const account = savedAccounts[email];

      if (!account) {
        throw new Error('Account not found. Please sign up first.');
      }

      if (account.password !== password) {
        throw new Error('Invalid password');
      }

      setUser({
        email,
        authMethod: 'email',
      });
      return;
    }

    // REAL implementation - TODO: Connect to your backend
    // For now, using localStorage
    const savedAccounts = JSON.parse(localStorage.getItem('arctos_accounts') || '{}');
    const account = savedAccounts[email];

    if (!account) {
      throw new Error('Account not found. Please sign up first.');
    }

    if (account.password !== password) {
      throw new Error('Invalid password');
    }

    setUser({
      email,
      authMethod: 'email',
    });
  };

  const signUpWithEmail = async (email: string, password: string): Promise<void> => {
    // In development mode, minimal validation
    if (import.meta.env.VITE_APP_MOCK_MODE === 'true') {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!email.includes('@')) {
        throw new Error('Invalid email address');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const savedAccounts = JSON.parse(localStorage.getItem('arctos_accounts') || '{}');

      if (savedAccounts[email]) {
        throw new Error('Account already exists. Please sign in.');
      }

      savedAccounts[email] = { password };
      localStorage.setItem('arctos_accounts', JSON.stringify(savedAccounts));

      setUser({
        email,
        authMethod: 'email',
      });
      return;
    }

    // REAL implementation - TODO: Connect to your backend
    if (!email.includes('@')) {
      throw new Error('Invalid email address');
    }

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const savedAccounts = JSON.parse(localStorage.getItem('arctos_accounts') || '{}');

    if (savedAccounts[email]) {
      throw new Error('Account already exists. Please sign in.');
    }

    // In production, you would hash the password before storing
    savedAccounts[email] = { 
      password, // TODO: Hash this in production!
      createdAt: new Date().toISOString()
    };
    localStorage.setItem('arctos_accounts', JSON.stringify(savedAccounts));

    setUser({
      email,
      authMethod: 'email',
    });
  };

  const signOut = () => {
    setUser(null);
  };

  const isAuthenticated = user !== null;
  const isWalletConnected = user?.authMethod === 'wallet';

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isWalletConnected,
        connectWallet,
        disconnectWallet,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        availableWallets
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}