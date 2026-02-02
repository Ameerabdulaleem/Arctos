// Extend the Window interface to include wallet providers
interface Window {
  // MetaMask / EIP-1193 Providers
  ethereum?: {
    isMetaMask?: boolean;
    isConnected: () => boolean;
    request: (args: { method: string; params?: any[] }) => Promise<any>;
    on: (event: string, callback: (...args: any[]) => void) => void;
    removeListener: (event: string, callback: (...args: any[]) => void) => void;
    chainId: string;
    selectedAddress: string | null;
    // For multiple wallet support
    providers?: any[];
    // For WalletConnect
    isWalletConnect?: boolean;
  };
  
  // Legacy web3 (some dApps still use this)
  web3?: {
    currentProvider: any;
  };
  
  // Solana (Phantom Wallet)
  solana?: {
    isPhantom?: boolean;
    connect: () => Promise<{ publicKey: { toString: () => string } }>;
    disconnect: () => Promise<void>;
  };
  
  // Keplr (Cosmos)
  keplr?: any;
  
  // WalletConnect
  WalletConnect?: any;
  walletConnect?: any;
  
  // Custom injected providers
  arctosWallet?: any; // If you create your own extension someday
}

// Extend EIP-1193 Provider type if needed
interface EIP1193Provider {
  request(args: { method: string; params?: any[] }): Promise<any>;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

// For event types
interface MetaMaskEthereumProvider {
  isMetaMask: boolean;
  chainId: string;
  selectedAddress: string;
}