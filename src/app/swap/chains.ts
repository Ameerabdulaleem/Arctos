// The chains the swap and bridge panel offers, with what each provider calls them.
// Chain ids follow Relay: EVM chain ids, and 792703809 for Solana.

export type Vm = 'evm' | 'svm';

export interface SwapChain {
  id: number;
  key: string;
  name: string;
  vm: Vm;
  native: { symbol: string; name: string; decimals: number };
  /** The wrapped native token, used to chart the native coin and by some routers. */
  wrapped: string;
  explorer: string;
  /** A public RPC for reading balances and token details. */
  rpc: string;
  /** A second public RPC, tried when the first refuses. */
  rpcFallback?: string;
  /** DexScreener's chain slug. */
  dexscreener: string;
  /** KyberSwap's chain slug, when KyberSwap routes on this chain. */
  kyber?: string;
  /** Squid's chain id, when Squid bridges to or from this chain. */
  squid?: string;
}

export const SOLANA_ID = 792703809;

/** How EVM aggregators write the native coin. */
export const EVM_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
/** How Relay writes the native coin on EVM chains. */
export const RELAY_EVM_NATIVE = '0x0000000000000000000000000000000000000000';
/** How Relay writes native SOL. */
export const RELAY_SOL_NATIVE = '11111111111111111111111111111111';
/** Wrapped SOL, which Jupiter uses for SOL. Arctos uses it as the address of SOL. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export const CHAINS: SwapChain[] = [
  {
    id: SOLANA_ID, key: 'solana', name: 'Solana', vm: 'svm',
    native: { symbol: 'SOL', name: 'Solana', decimals: 9 }, wrapped: SOL_MINT,
    explorer: 'https://solscan.io', rpc: 'https://api.mainnet-beta.solana.com', rpcFallback: 'https://solana-rpc.publicnode.com', dexscreener: 'solana', squid: 'solana-mainnet-beta',
  },
  {
    id: 56, key: 'bsc', name: 'BNB Chain', vm: 'evm',
    native: { symbol: 'BNB', name: 'BNB', decimals: 18 }, wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    explorer: 'https://bscscan.com', rpc: 'https://bsc-rpc.publicnode.com', dexscreener: 'bsc', kyber: 'bsc', squid: '56',
  },
  {
    id: 1, key: 'ethereum', name: 'Ethereum', vm: 'evm',
    native: { symbol: 'ETH', name: 'Ether', decimals: 18 }, wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    explorer: 'https://etherscan.io', rpc: 'https://ethereum-rpc.publicnode.com', dexscreener: 'ethereum', kyber: 'ethereum', squid: '1',
  },
  {
    id: 8453, key: 'base', name: 'Base', vm: 'evm',
    native: { symbol: 'ETH', name: 'Ether', decimals: 18 }, wrapped: '0x4200000000000000000000000000000000000006',
    explorer: 'https://basescan.org', rpc: 'https://base-rpc.publicnode.com', dexscreener: 'base', kyber: 'base', squid: '8453',
  },
  {
    id: 42161, key: 'arbitrum', name: 'Arbitrum', vm: 'evm',
    native: { symbol: 'ETH', name: 'Ether', decimals: 18 }, wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    explorer: 'https://arbiscan.io', rpc: 'https://arbitrum-one-rpc.publicnode.com', dexscreener: 'arbitrum', kyber: 'arbitrum', squid: '42161',
  },
  {
    id: 137, key: 'polygon', name: 'Polygon', vm: 'evm',
    native: { symbol: 'POL', name: 'POL', decimals: 18 }, wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    explorer: 'https://polygonscan.com', rpc: 'https://polygon-bor-rpc.publicnode.com', dexscreener: 'polygon', kyber: 'polygon', squid: '137',
  },
  {
    id: 10, key: 'optimism', name: 'Optimism', vm: 'evm',
    native: { symbol: 'ETH', name: 'Ether', decimals: 18 }, wrapped: '0x4200000000000000000000000000000000000006',
    explorer: 'https://optimistic.etherscan.io', rpc: 'https://optimism-rpc.publicnode.com', dexscreener: 'optimism', kyber: 'optimism', squid: '10',
  },
  {
    id: 43114, key: 'avalanche', name: 'Avalanche', vm: 'evm',
    native: { symbol: 'AVAX', name: 'Avalanche', decimals: 18 }, wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    explorer: 'https://snowtrace.io', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', dexscreener: 'avalanche', kyber: 'avalanche', squid: '43114',
  },
  {
    id: 59144, key: 'linea', name: 'Linea', vm: 'evm',
    native: { symbol: 'ETH', name: 'Ether', decimals: 18 }, wrapped: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    explorer: 'https://lineascan.build', rpc: 'https://linea-rpc.publicnode.com', dexscreener: 'linea', kyber: 'linea', squid: '59144',
  },
  {
    id: 146, key: 'sonic', name: 'Sonic', vm: 'evm',
    native: { symbol: 'S', name: 'Sonic', decimals: 18 }, wrapped: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
    explorer: 'https://sonicscan.org', rpc: 'https://sonic-rpc.publicnode.com', dexscreener: 'sonic', kyber: 'sonic', squid: '146',
  },
];

const BY_ID = new Map(CHAINS.map((c) => [c.id, c]));
const BY_KEY = new Map(CHAINS.map((c) => [c.key, c]));

export function chainById(id: number): SwapChain | undefined {
  return BY_ID.get(id);
}

/** Looks a chain up by its key, also accepting the names the sniper uses. */
export function chainByKey(key: string): SwapChain | undefined {
  const k = key.toLowerCase();
  return BY_KEY.get(k) ?? BY_KEY.get(k === 'bnb' || k === 'binance' ? 'bsc' : k === 'eth' ? 'ethereum' : k === 'sol' ? 'solana' : k);
}

export function isNative(chain: SwapChain, address: string): boolean {
  return chain.vm === 'svm' ? address === SOL_MINT || address === RELAY_SOL_NATIVE : address.toLowerCase() === EVM_NATIVE || address === RELAY_EVM_NATIVE;
}

export function txUrl(chain: SwapChain, hash: string): string {
  return `${chain.explorer}/tx/${encodeURIComponent(hash)}`;
}

export function tokenUrl(chain: SwapChain, address: string): string {
  return chain.vm === 'svm' ? `${chain.explorer}/token/${encodeURIComponent(address)}` : `${chain.explorer}/token/${encodeURIComponent(address)}`;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeAddress(chain: SwapChain, text: string): boolean {
  return chain.vm === 'evm' ? EVM_ADDRESS.test(text) : SOL_ADDRESS.test(text);
}
