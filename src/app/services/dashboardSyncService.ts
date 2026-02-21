export type ActivityType = 'buy' | 'sell' | 'stake' | 'swap' | 'receive' | 'claim';

export interface RecentActivity {
  action: string;
  amount: string;
  value: string;
  time: string;
  chain: string;
  chainColor: string;
  type: ActivityType;
}

export interface DashboardMetrics {
  portfolioValue: number;
  portfolioChangePercent: number;
  portfolioChangeValue: number;
  altseasonIndex: number;
  altseasonTrend: number[];
  btcDominance: number;
  ethDominance: number;
  dominanceMap: Record<string, number>;
  totalMarketCap: number;
  marketCapChangePercent: number;
  marketCapTrend: number[];
  fearGreedIndex: number;
}

export interface AssetItem {
  name: string;
  symbol: string;
  chain: string;
  amount: string;
  value: string;
  change24h: number;
}

export interface DashboardAssets {
  tokens: AssetItem[];
  defi: AssetItem[];
  nfts: AssetItem[];
}

export interface DashboardSnapshot {
  metrics: DashboardMetrics;
  recentActivities: RecentActivity[];
  assets: DashboardAssets;
  updatedAt: string;
}

const DEFAULT_SNAPSHOT: DashboardSnapshot = {
  metrics: {
    portfolioValue: 128456.32,
    portfolioChangePercent: 4.82,
    portfolioChangeValue: 5894.12,
    altseasonIndex: 67,
    altseasonTrend: [42, 45, 48, 52, 57, 60, 63, 67],
    btcDominance: 51.2,
    ethDominance: 18.7,
    dominanceMap: {
      BTC: 51.2,
      ETH: 18.7,
      USDT: 5.8,
      BNB: 3.9,
      SOL: 3.3,
      OTHERS: 17.1
    },
    totalMarketCap: 2.41e12,
    marketCapChangePercent: 2.1,
    marketCapTrend: [2.22, 2.24, 2.27, 2.31, 2.28, 2.35, 2.39, 2.41],
    fearGreedIndex: 72
  },
  recentActivities: [
    {
      action: 'Bought ETH',
      amount: '+2.456 ETH',
      value: '$4,856.78',
      time: '2 mins ago',
      chain: 'ETH',
      chainColor: 'bg-blue-500',
      type: 'buy'
    },
    {
      action: 'Staked SOL',
      amount: '125 SOL',
      value: '$9,234.56',
      time: '15 mins ago',
      chain: 'SOL',
      chainColor: 'bg-purple-500',
      type: 'stake'
    },
    {
      action: 'Sold BNB',
      amount: '-12.5 BNB',
      value: '$3,456.78',
      time: '32 mins ago',
      chain: 'BNB',
      chainColor: 'bg-yellow-500',
      type: 'sell'
    },
    {
      action: 'Swapped USDT',
      amount: '500 USDT → TON',
      value: '$500.00',
      time: '1 hour ago',
      chain: 'TON',
      chainColor: 'bg-blue-600',
      type: 'swap'
    },
    {
      action: 'Received NFT',
      amount: 'Mad Lad #8234',
      value: '$9,234.50',
      time: '2 hours ago',
      chain: 'SOL',
      chainColor: 'bg-purple-500',
      type: 'receive'
    },
    {
      action: 'Claimed Rewards',
      amount: '+45.67 CAKE',
      value: '$234.56',
      time: '3 hours ago',
      chain: 'BNB',
      chainColor: 'bg-yellow-500',
      type: 'claim'
    }
  ],
  assets: {
    tokens: [
      { name: 'Ethereum', symbol: 'ETH', chain: 'ETH', amount: '12.84', value: '$25,217.31', change24h: 2.4 },
      { name: 'Solana', symbol: 'SOL', chain: 'SOL', amount: '326.1', value: '$61,492.20', change24h: 6.1 },
      { name: 'BNB', symbol: 'BNB', chain: 'BNB', amount: '54.7', value: '$17,231.53', change24h: -1.2 },
      { name: 'Tether', symbol: 'USDT', chain: 'ETH', amount: '4,500', value: '$4,500.00', change24h: 0 }
    ],
    defi: [
      { name: 'Jito Staked SOL', symbol: 'JITOSOL', chain: 'SOL', amount: '18.2', value: '$3,410.74', change24h: 4.9 },
      { name: 'Pancake LP', symbol: 'CAKE-LP', chain: 'BNB', amount: '11.7', value: '$2,107.33', change24h: 1.6 }
    ],
    nfts: [
      { name: 'Mad Lads', symbol: 'MADLAD', chain: 'SOL', amount: '1', value: '$9,234.50', change24h: 12.2 },
      { name: 'Azuki', symbol: 'AZUKI', chain: 'ETH', amount: '1', value: '$14,122.00', change24h: -2.3 }
    ]
  },
  updatedAt: new Date().toISOString()
};

const formatWsUrl = (baseUrl: string): string => {
  if (!baseUrl) return '';
  if (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')) {
    return `${baseUrl.replace(/\/$/, '')}/ws/dashboard`;
  }
  if (baseUrl.startsWith('http://')) {
    return `${baseUrl.replace('http://', 'ws://').replace(/\/$/, '')}/ws/dashboard`;
  }
  if (baseUrl.startsWith('https://')) {
    return `${baseUrl.replace('https://', 'wss://').replace(/\/$/, '')}/ws/dashboard`;
  }
  return '';
};

const rustApiBase = (import.meta.env.VITE_RUST_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || '';
const fallbackApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

const getApiBase = (): string => rustApiBase || fallbackApiBase;
const getWsUrl = (): string => {
  const explicitWs = (import.meta.env.VITE_RUST_WS_URL as string | undefined)?.replace(/\/$/, '');
  if (explicitWs) return `${explicitWs}/ws/dashboard`;
  return formatWsUrl(getApiBase());
};

const toCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value > 1_000_000_000 ? 0 : 2
  }).format(value);

const snapshotFromApi = (payload: Partial<DashboardSnapshot>): DashboardSnapshot => {
  const merged: DashboardSnapshot = {
    metrics: {
      ...DEFAULT_SNAPSHOT.metrics,
      ...(payload.metrics || {})
    },
    recentActivities: payload.recentActivities || DEFAULT_SNAPSHOT.recentActivities,
    assets: {
      tokens: payload.assets?.tokens || DEFAULT_SNAPSHOT.assets.tokens,
      defi: payload.assets?.defi || DEFAULT_SNAPSHOT.assets.defi,
      nfts: payload.assets?.nfts || DEFAULT_SNAPSHOT.assets.nfts
    },
    updatedAt: payload.updatedAt || new Date().toISOString()
  };

  return {
    ...merged,
    recentActivities: merged.recentActivities.slice(0, 10)
  };
};

class DashboardSyncService {
  async getInitialSnapshot(): Promise<DashboardSnapshot> {
    const apiBase = getApiBase();

    if (!apiBase) {
      return DEFAULT_SNAPSHOT;
    }

    try {
      const response = await fetch(`${apiBase}/api/dashboard/overview`);
      if (!response.ok) {
        return DEFAULT_SNAPSHOT;
      }

      const payload = (await response.json()) as Partial<DashboardSnapshot>;
      return snapshotFromApi(payload);
    } catch {
      return DEFAULT_SNAPSHOT;
    }
  }

  subscribeToUpdates(onSnapshot: (snapshot: DashboardSnapshot) => void): () => void {
    const wsUrl = getWsUrl();
    if (!wsUrl) {
      return () => undefined;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closedByClient = false;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as Partial<DashboardSnapshot>;
          const nextSnapshot = snapshotFromApi(payload);
          onSnapshot(nextSnapshot);
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
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }

  formatPortfolio(value: number): string {
    return toCurrency(value);
  }

  formatMarketCap(value: number): string {
    if (value >= 1_000_000_000_000) {
      return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
    }
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    }
    return toCurrency(value);
  }
}

export const dashboardSyncService = new DashboardSyncService();
