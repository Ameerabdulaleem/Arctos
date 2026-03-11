// ─── useAIContext ─────────────────────────────────────────────────────────────
// Aggregates live data from TradeBook, SniperPanel, FundamentalNews, and Auth
// into a single snapshot the AI Chat uses to build a context-aware system prompt.
// Data sources:
//   - TradeBook → localStorage key `arctos_tradebook`
//   - Sniper    → sniperService.getTrackedTokens()
//   - News      → newsService.getNews() (top 5 articles)
//   - Auth      → useAuth() context
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import { newsService, type NewsArticle } from '@/app/services/newsService';
import { sniperService, type SniperToken, type SniperConfig } from '@/app/services/sniperService';

// ─── Trade shape (mirrors TradeBook.tsx) ──────────────────────────────────────

export interface TradeRecord {
  id: string;
  tokenName: string;
  priceBought: string;
  amount: string;
  priceSold: string;
  profitLoss: number;
  date: string;
}

export interface TradeStats {
  total: number;
  open: number;
  closed: number;
  winRate: string;
  netPL: number;
  totalProfit: number;
  totalLoss: number;
  winningTrades: number;
}

// ─── Aggregated context shape ─────────────────────────────────────────────────

export interface AIContextData {
  // Auth
  walletAddress: string | null;
  chainId: string | number | null;
  isWalletConnected: boolean;
  isAuthenticated: boolean;

  // TradeBook
  trades: TradeRecord[];
  tradeStats: TradeStats;

  // Sniper
  sniperTokens: SniperToken[];
  sniperConfig: SniperConfig;

  // News
  recentNews: NewsArticle[];

  // Meta
  isLoading: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readTradesFromStorage(): TradeRecord[] {
  try {
    const raw = localStorage.getItem('arctos_tradebook');
    if (!raw) return [];
    return JSON.parse(raw) as TradeRecord[];
  } catch {
    return [];
  }
}

function computeTradeStats(trades: TradeRecord[]): TradeStats {
  const isOpen = (t: TradeRecord) => !t.priceSold || parseFloat(t.priceSold) === 0;
  const closed = trades.filter((t) => !isOpen(t));
  const open = trades.filter(isOpen);
  const winning = closed.filter((t) => t.profitLoss > 0);
  const totalProfit = closed.reduce((s, t) => s + (t.profitLoss > 0 ? t.profitLoss : 0), 0);
  const totalLoss = closed.reduce((s, t) => s + (t.profitLoss < 0 ? Math.abs(t.profitLoss) : 0), 0);
  const netPL = closed.reduce((s, t) => s + t.profitLoss, 0);
  const winRate =
    closed.length > 0
      ? `${((winning.length / closed.length) * 100).toFixed(1)}%`
      : 'N/A';

  return {
    total: trades.length,
    open: open.length,
    closed: closed.length,
    winRate,
    netPL,
    totalProfit,
    totalLoss,
    winningTrades: winning.length,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAIContext(): AIContextData {
  const { user, isWalletConnected, isAuthenticated } = useAuth();

  // TradeBook — read once on mount (trades persist in localStorage)
  const [trades, setTrades] = useState<TradeRecord[]>(() => readTradesFromStorage());

  const [sniperTokens, setSniperTokens] = useState<SniperToken[]>([]);
  const [sniperConfig] = useState<SniperConfig>(sniperService.getDefaultConfig());
  const [recentNews, setRecentNews] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Re-read trades in case user navigated away and added some
      setTrades(readTradesFromStorage());

      const [tokens, newsResult] = await Promise.all([
        sniperService.getTrackedTokens(),
        newsService.getNews(),
      ]);

      if (!mounted) return;

      setSniperTokens(tokens);
      setRecentNews(newsResult.slice(0, 6));
      setIsLoading(false);
    };

    void init();

    // Subscribe to sniper token updates for live streaming data
    const unsub = sniperService.subscribeToUpdates((event) => {
      if (!mounted) return;
      if (event.type === 'token_update' && event.token) {
        setSniperTokens((prev) =>
          prev.map((t) => (t.id === event.token?.id ? { ...t, ...event.token } : t)),
        );
      }
    });

    // Poll localStorage every 10 s in case the user updates TradeBook while chat is open
    const tradesInterval = setInterval(() => {
      setTrades(readTradesFromStorage());
    }, 10_000);

    return () => {
      mounted = false;
      unsub();
      clearInterval(tradesInterval);
    };
  }, []);

  return {
    walletAddress: user?.walletAddress ?? null,
    chainId: user?.chainId ?? null,
    isWalletConnected,
    isAuthenticated,
    trades,
    tradeStats: computeTradeStats(trades),
    sniperTokens,
    sniperConfig,
    recentNews,
    isLoading,
  };
}
