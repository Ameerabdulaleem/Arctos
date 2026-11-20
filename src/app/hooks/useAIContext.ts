import { useMemo } from 'react';
import { usePaper } from '../contexts/paper-context';
import { readTrades } from '../lib/tradebook';
import type { PortfolioResponse } from '../services/portfolioService';
import type { UserContext, WalletContext } from '../services/aiService';
import type { ConnectedWallet } from './useConnectedWallets';

/** The largest holdings of each wallet are shared; the rest are counted. */
const HOLDINGS_SHARED = 25;

function walletContext(w: ConnectedWallet, data: PortfolioResponse | null | undefined): WalletContext {
  if (!data) return { address: w.address, kind: w.kind };
  const sorted = [...data.holdings].sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return {
    address: w.address,
    kind: w.kind,
    totalUsd: data.totalUsd,
    hiddenTokens: (data.hiddenTokens ?? 0) + Math.max(0, sorted.length - HOLDINGS_SHARED),
    holdings: sorted.slice(0, HOLDINGS_SHARED).map((h) => ({
      symbol: h.symbol, name: h.name, chain: h.chainName, amount: h.amount, valueUsd: h.valueUsd, change24h: h.change24h, ...(h.address ? { address: h.address } : {}),
    })),
  };
}

/**
 * Builds the portfolio facts shared with the AI assistant: the connected wallets and what they
 * hold, the paper account and the trade book. Live market data is added by the server.
 */
export function useAIContext(wallets: ConnectedWallet[], portfolios: Array<PortfolioResponse | null> | null): { context: () => UserContext } {
  const paper = usePaper();

  return useMemo(
    () => ({
      context: (): UserContext => ({
        trades: readTrades()
          .slice(0, 15)
          .map((t) => ({
            tokenName: t.tokenName,
            priceBought: Number(t.priceBought) || 0,
            amount: Number(t.amount) || 0,
            priceSold: Number(t.priceSold) || 0,
            profitLoss: t.profitLoss,
          })),
        paper: {
          cashUsd: paper.account.cash,
          equityUsd: paper.equity,
          realizedPnlUsd: paper.account.realizedPnl,
          positions: paper.positions.slice(0, 15).map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice })),
        },
        wallets: wallets.slice(0, 3).map((w) => walletContext(w, portfolios?.find((p) => p?.address.toLowerCase() === w.address.toLowerCase()))),
      }),
    }),
    [paper.account.cash, paper.equity, paper.account.realizedPnl, paper.positions, wallets, portfolios],
  );
}
