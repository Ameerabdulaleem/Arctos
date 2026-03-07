export type SupportedChain = 'solana' | 'bnb' | 'base' | 'ethereum' | 'arbitrum' | 'other';

export type SniperStatus = 'active' | 'paused' | 'triggered';

export interface SniperToken {
  id: string;
  symbol: string;
  name: string;
  address: string;
  chain: SupportedChain;
  price: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  change24h: number;
  status: SniperStatus;
}

export interface SniperConfig {
  minLiquidityUsdK: number;
  maxBuyTaxPercent: number;
  maxSellTaxPercent: number;
  gasPriceGwei: number;
  slippagePercent: number;
  maxPositionUsd: number;
  minCreatorWinRate: number;
  maxRiskScore: number;
  autoTakeProfitPercent: number;
  autoStopLossPercent: number;
}

export interface SniperExecution {
  token: string;
  action: 'Buy' | 'Sell';
  amount: string;
  valueUsd: number;
  time: string;
  success: boolean;
}

interface SniperUpdateEvent {
  type: 'token_update' | 'execution';
  token?: Partial<SniperToken> & { id: string };
  execution?: SniperExecution;
}

const DEFAULT_CONFIG: SniperConfig = {
  minLiquidityUsdK: 50,
  maxBuyTaxPercent: 10,
  maxSellTaxPercent: 10,
  gasPriceGwei: 5,
  slippagePercent: 12,
  maxPositionUsd: 250,
  minCreatorWinRate: 60,
  maxRiskScore: 40,
  autoTakeProfitPercent: 100,
  autoStopLossPercent: 30,
};

const DEFAULT_TOKENS: SniperToken[] = [
  {
    id: 'pepe-eth',
    symbol: 'PEPE',
    name: 'Pepe Token',
    address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    chain: 'ethereum',
    price: 0.00000123,
    liquidityUsd: 1_200_000,
    marketCapUsd: 456_000_000,
    holders: 12_450,
    change24h: 45.2,
    status: 'active',
  },
  {
    id: 'shib-eth',
    symbol: 'SHIB',
    name: 'Shiba Inu',
    address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    chain: 'ethereum',
    price: 0.00000856,
    liquidityUsd: 5_400_000,
    marketCapUsd: 3_200_000_000,
    holders: 89_230,
    change24h: 12.8,
    status: 'paused',
  },
  {
    id: 'doge-bnb',
    symbol: 'DOGE',
    name: 'Dogecoin (BSC)',
    address: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43',
    chain: 'bnb',
    price: 0.078945,
    liquidityUsd: 12_300_000,
    marketCapUsd: 11_000_000_000,
    holders: 234_560,
    change24h: -5.3,
    status: 'triggered',
  },
];

const IS_MOCK = (import.meta.env.VITE_APP_SNIPER_MOCK_MODE as string | undefined) !== 'false';
const rustApiBase = (import.meta.env.VITE_RUST_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || '';
const fallbackApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

const getApiBase = (): string => rustApiBase || fallbackApiBase;

const formatWsUrl = (baseUrl: string): string => {
  if (!baseUrl) return '';
  if (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')) {
    return `${baseUrl.replace(/\/$/, '')}/ws/sniper`;
  }
  if (baseUrl.startsWith('http://')) {
    return `${baseUrl.replace('http://', 'ws://').replace(/\/$/, '')}/ws/sniper`;
  }
  if (baseUrl.startsWith('https://')) {
    return `${baseUrl.replace('https://', 'wss://').replace(/\/$/, '')}/ws/sniper`;
  }
  return '';
};

const chainLabelMap: Record<SupportedChain, string> = {
  solana: 'SOL',
  bnb: 'BNB',
  base: 'BASE',
  ethereum: 'ETH',
  arbitrum: 'ARB',
  other: 'OTHER',
};

const randomTokenFromQuery = (query: string, chain: SupportedChain): SniperToken => {
  const clean = query.trim();
  const symbol = clean.slice(0, 6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'NEW';
  const suffix = Math.random().toString(16).slice(2, 8);
  const randomAddress = clean.startsWith('0x')
    ? clean
    : `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 42);

  return {
    id: `${symbol.toLowerCase()}-${suffix}`,
    symbol,
    name: clean.length > 1 ? clean : `${symbol} Token`,
    address: randomAddress,
    chain,
    price: Number((Math.random() * 0.02).toFixed(8)),
    liquidityUsd: Math.floor(Math.random() * 1_200_000 + 50_000),
    marketCapUsd: Math.floor(Math.random() * 30_000_000 + 1_500_000),
    holders: Math.floor(Math.random() * 12_000 + 120),
    change24h: Number(((Math.random() - 0.4) * 150).toFixed(2)),
    status: 'paused',
  };
};

const tokenFromApi = (payload: Partial<SniperToken>, fallbackChain: SupportedChain): SniperToken => ({
  id: payload.id || crypto.randomUUID(),
  symbol: payload.symbol || 'NEW',
  name: payload.name || 'New Token',
  address: payload.address || '',
  chain: payload.chain || fallbackChain,
  price: payload.price ?? 0,
  liquidityUsd: payload.liquidityUsd ?? 0,
  marketCapUsd: payload.marketCapUsd ?? 0,
  holders: payload.holders ?? 0,
  change24h: payload.change24h ?? 0,
  status: payload.status || 'paused',
});

class SniperService {
  private cachedConfig: SniperConfig = DEFAULT_CONFIG;

  getDefaultConfig(): SniperConfig {
    return this.cachedConfig;
  }

  async getTrackedTokens(): Promise<SniperToken[]> {
    const apiBase = getApiBase();
    if (!apiBase || IS_MOCK) return DEFAULT_TOKENS;

    try {
      const response = await fetch(`${apiBase}/api/sniper/tokens`);
      if (!response.ok) return DEFAULT_TOKENS;

      const payload = (await response.json()) as Partial<SniperToken>[];
      return payload.map((token) => tokenFromApi(token, token.chain || 'other'));
    } catch {
      return DEFAULT_TOKENS;
    }
  }

  async searchToken(query: string, chain: SupportedChain): Promise<SniperToken | null> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return null;

    const apiBase = getApiBase();
    if (!apiBase || IS_MOCK) {
      const existing = DEFAULT_TOKENS.find(
        (token) =>
          token.chain === chain &&
          (token.symbol.toLowerCase() === cleanQuery.toLowerCase() ||
            token.name.toLowerCase().includes(cleanQuery.toLowerCase()) ||
            token.address.toLowerCase() === cleanQuery.toLowerCase()),
      );
      return existing || randomTokenFromQuery(cleanQuery, chain);
    }

    try {
      const params = new URLSearchParams({ query: cleanQuery, chain });
      const response = await fetch(`${apiBase}/api/sniper/token-search?${params.toString()}`);
      if (!response.ok) return null;

      const payload = (await response.json()) as Partial<SniperToken>;
      return tokenFromApi(payload, chain);
    } catch {
      return null;
    }
  }

  async saveConfig(config: SniperConfig): Promise<boolean> {
    this.cachedConfig = config;

    const apiBase = getApiBase();
    if (!apiBase || IS_MOCK) return true;

    try {
      const response = await fetch(`${apiBase}/api/sniper/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async setBotState(active: boolean, walletAddress?: string): Promise<boolean> {
    const apiBase = getApiBase();
    if (!apiBase || IS_MOCK) return true;

    try {
      const response = await fetch(`${apiBase}/api/sniper/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, walletAddress }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async snipeNow(token: SniperToken, walletAddress?: string): Promise<SniperExecution | null> {
    const apiBase = getApiBase();
    if (!apiBase || IS_MOCK) {
      return {
        token: token.symbol,
        action: 'Buy',
        amount: `${Math.floor(Math.random() * 900_000 + 100_000).toLocaleString()}`,
        valueUsd: Number((Math.random() * 2_500 + 200).toFixed(2)),
        time: 'just now',
        success: Math.random() > 0.15,
      };
    }

    try {
      const response = await fetch(`${apiBase}/api/sniper/snipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          tokenAddress: token.address,
          chain: token.chain,
          walletAddress,
        }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as SniperExecution;
      return payload;
    } catch {
      return null;
    }
  }

  subscribeToUpdates(onUpdate: (update: SniperUpdateEvent) => void): () => void {
    const wsUrl = formatWsUrl(getApiBase());
    if (!wsUrl || IS_MOCK) return () => undefined;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closedByClient = false;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as SniperUpdateEvent;
          onUpdate(payload);
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (closedByClient) return;
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closedByClient = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value >= 1 ? 2 : 8,
    }).format(value);
  }

  formatCompactCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatChain(chain: SupportedChain): string {
    return chainLabelMap[chain];
  }
}

export const sniperService = new SniperService();
