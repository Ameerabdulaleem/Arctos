// Wallet connections. EVM wallets are found with EIP 6963 (each wallet announces itself, so MetaMask,
// Rabby, OKX and Phantom no longer fight over window.ethereum). Phantom also provides Solana.
// Everything here is read only: the app asks for an address, never for a signature or a transaction.

export type WalletType = 'metamask' | 'phantom' | 'rabby' | 'okx';
export type WalletChainKind = 'evm' | 'solana';

export interface WalletConnection {
  address: string;
  chainId: number | null;
  walletType: WalletType;
  kind: WalletChainKind;
}

export interface WalletOption {
  id: WalletType;
  name: string;
  description: string;
  installUrl: string;
}

export const WALLET_OPTIONS: WalletOption[] = [
  { id: 'metamask', name: 'MetaMask', description: 'Ethereum, BNB Chain, Base, Arbitrum', installUrl: 'https://metamask.io/download/' },
  { id: 'rabby', name: 'Rabby', description: 'Multi chain EVM wallet', installUrl: 'https://rabby.io/' },
  { id: 'okx', name: 'OKX Wallet', description: 'Multi chain wallet', installUrl: 'https://www.okx.com/web3' },
  { id: 'phantom', name: 'Phantom', description: 'Solana (and Phantom EVM)', installUrl: 'https://phantom.app/download' },
];

const RDNS: Record<WalletType, string[]> = {
  metamask: ['io.metamask', 'io.metamask.flask'],
  rabby: ['io.rabby'],
  okx: ['com.okex.wallet'],
  phantom: ['app.phantom'],
};

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddress(address: string, kind: WalletChainKind): boolean {
  return kind === 'evm' ? EVM_ADDRESS.test(address) : SOLANA_ADDRESS.test(address);
}

const announced = new Map<string, Eip1193Provider>();
let listening = false;

function startDiscovery() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = event.detail;
    announced.set(info.rdns, provider);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Gives wallets a moment to announce themselves, then looks the provider up. */
async function findEvmProvider(type: WalletType): Promise<Eip1193Provider | null> {
  startDiscovery();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, 150));
  for (const rdns of RDNS[type]) {
    const p = announced.get(rdns);
    if (p) return p;
  }
  // Legacy fallbacks for wallets that do not support EIP 6963 yet.
  if (type === 'okx' && window.okxwallet) return window.okxwallet;
  if (type === 'phantom' && window.phantom?.ethereum) return window.phantom.ethereum;
  const eth = window.ethereum;
  if (!eth) return null;
  const candidates = eth.providers?.length ? eth.providers : [eth];
  if (type === 'metamask') return candidates.find((p) => p.isMetaMask && !p.isRabby && !p.isPhantom && !p.isOkxWallet) ?? null;
  if (type === 'rabby') return candidates.find((p) => p.isRabby) ?? null;
  return null;
}

export function installedWallets(): Promise<Record<WalletType, boolean>> {
  return (async () => {
    const result = { metamask: false, rabby: false, okx: false, phantom: false } as Record<WalletType, boolean>;
    for (const w of WALLET_OPTIONS) {
      result[w.id] = w.id === 'phantom' ? Boolean(window.phantom?.solana) || Boolean(await findEvmProvider('phantom')) : Boolean(await findEvmProvider(w.id));
    }
    return result;
  })();
}

function hexToNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = parseInt(value, 16);
  return Number.isFinite(n) ? n : null;
}

export class WalletError extends Error {
  readonly code: 'not_installed' | 'rejected' | 'invalid' | 'unknown';
  constructor(code: WalletError['code'], message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

function toWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error;
  const code = (error as { code?: number })?.code;
  if (code === 4001 || code === -32603 || /reject|denied|cancel/i.test(String((error as Error)?.message))) {
    return new WalletError('rejected', 'You closed the wallet request. Try again when you are ready.');
  }
  return new WalletError('unknown', 'The wallet could not connect. Please try again.');
}

export async function connectWallet(type: WalletType): Promise<WalletConnection> {
  try {
    if (type === 'phantom' && window.phantom?.solana) {
      const resp = await window.phantom.solana.connect();
      const address = resp.publicKey.toString();
      if (!isValidAddress(address, 'solana')) throw new WalletError('invalid', 'The wallet returned an address we could not read.');
      return { address, chainId: null, walletType: 'phantom', kind: 'solana' };
    }
    const provider = await findEvmProvider(type);
    if (!provider) {
      const name = WALLET_OPTIONS.find((w) => w.id === type)?.name ?? 'That wallet';
      throw new WalletError('not_installed', `${name} was not found in this browser.`);
    }
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts?.[0];
    if (!address || !isValidAddress(address, 'evm')) throw new WalletError('invalid', 'The wallet returned an address we could not read.');
    const chainId = hexToNumber(await provider.request({ method: 'eth_chainId' }));
    return { address, chainId, walletType: type, kind: 'evm' };
  } catch (error) {
    throw toWalletError(error);
  }
}

/** Quietly checks whether a saved wallet session is still connected. Never opens a prompt. */
export async function restoreWallet(saved: WalletConnection): Promise<WalletConnection | null> {
  try {
    if (saved.kind === 'solana') {
      const sol = window.phantom?.solana;
      if (!sol) return null;
      const resp = await sol.connect({ onlyIfTrusted: true });
      const address = resp.publicKey.toString();
      return address === saved.address ? saved : { ...saved, address };
    }
    const provider = await findEvmProvider(saved.walletType);
    if (!provider) return null;
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    const address = accounts?.[0];
    if (!address || !isValidAddress(address, 'evm')) return null;
    return { ...saved, address, chainId: hexToNumber(await provider.request({ method: 'eth_chainId' })) ?? saved.chainId };
  } catch {
    return null;
  }
}

/** Listens for the user switching account, network or disconnecting inside the wallet. */
export function watchWallet(
  current: WalletConnection,
  onChange: (next: WalletConnection | null) => void,
): () => void {
  let stop = () => {};
  void (async () => {
    if (current.kind === 'solana') {
      const sol = window.phantom?.solana;
      if (!sol?.on) return;
      const onDisconnect = () => onChange(null);
      const onAccount = (pk: unknown) => {
        const address = (pk as { toString?: () => string } | null)?.toString?.();
        onChange(address && isValidAddress(address, 'solana') ? { ...current, address } : null);
      };
      sol.on('disconnect', onDisconnect);
      sol.on('accountChanged', onAccount);
      stop = () => {
        sol.off?.('disconnect', onDisconnect);
        sol.off?.('accountChanged', onAccount);
      };
      return;
    }
    const provider = await findEvmProvider(current.walletType);
    if (!provider?.on) return;
    const onAccounts = (accounts: unknown) => {
      const address = (accounts as string[] | undefined)?.[0];
      onChange(address && isValidAddress(address, 'evm') ? { ...current, address } : null);
    };
    const onChain = (id: unknown) => onChange({ ...current, chainId: hexToNumber(id) ?? current.chainId });
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    stop = () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  })();
  return () => stop();
}

export async function disconnectProvider(type: WalletType, kind: WalletChainKind): Promise<void> {
  // EVM wallets have no standard disconnect call, so only Phantom needs an explicit one.
  if (kind === 'solana') {
    try {
      await window.phantom?.solana?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  void type;
}
