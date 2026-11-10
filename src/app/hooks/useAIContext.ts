import { useMemo } from 'react';
import { useAuth } from '../contexts/auth-context';
import { usePaper } from '../contexts/paper-context';
import { readTrades } from '../lib/tradebook';
import type { UserContext } from '../services/aiService';

/** Builds the portfolio facts shared with the AI assistant. Live market data is added by the server. */
export function useAIContext(walletTotalUsd: number | null): { context: () => UserContext } {
  const { user } = useAuth();
  const paper = usePaper();
  const address = user?.walletAddress;

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
        wallet: address ? { address, totalUsd: walletTotalUsd ?? undefined } : undefined,
      }),
    }),
    [paper.account.cash, paper.equity, paper.account.realizedPnl, paper.positions, address, walletTotalUsd],
  );
}
