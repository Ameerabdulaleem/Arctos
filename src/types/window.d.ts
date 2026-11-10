// Typed shapes for the wallet providers the app talks to.

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isOkxWallet?: boolean;
  providers?: Eip1193Provider[];
}

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: Eip1193Provider;
  okxwallet?: Eip1193Provider;
  phantom?: { solana?: SolanaProvider; ethereum?: Eip1193Provider };
}

interface WindowEventMap {
  'eip6963:announceProvider': CustomEvent<{
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: Eip1193Provider;
  }>;
}
