import { useMemo } from 'react';
import { usePaper } from '../contexts/paper-context';
import { readTrades } from '../lib/tradebook';
import type { PortfolioResponse } from '../services/portfolioService';
import type { UserContext, WalletContext, WalletPnlContext } from '../services/aiService';
import type { PnlReport } from '../lib/walletPnlReport';
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

function pnlContext(r: PnlReport): WalletPnlContext {
  const t = r.pnl.totals;
  return {
    address: r.address,
    since: t.since,
    scanned: r.scanned,
    totals: { netUsd: t.netUsd, realizedUsd: t.realizedUsd, unrealizedUsd: t.unrealizedUsd, profitUsd: t.profitUsd, lossUsd: t.lossUsd, trades: t.trades, buys: t.buys, sells: t.sells, winRatePct: t.winRatePct, investedUsd: t.investedUsd, feesUsd: t.feesUsd },
    tokens: r.pnl.tokens.slice(0, 30).map((k) => ({
      symbol: r.names[k.mint]?.symbol ?? k.mint.slice(0, 6), mint: k.mint, buys: k.buys, sells: k.sells, investedUsd: k.investedUsd, proceedsUsd: k.proceedsUsd,
      avgCostUsd: k.avgCostUsd, realizedUsd: k.realizedUsd, heldQty: k.heldQty, priceUsd: k.priceUsd, valueUsd: k.valueUsd, unrealizedUsd: k.unrealizedUsd,
      totalUsd: k.totalUsd, firstAt: k.firstAt, lastAt: k.lastAt,
    })),
  };
}

/**
 * Builds the portfolio facts shared with the AI assistant: the connected wallets and what they
 * hold, the Trade Book's profit and loss, the paper account and the journal. Live market data
 * is added by the server.
 */
export function useAIContext(wallets: ConnectedWallet[], portfolios: Array<PortfolioResponse | null> | null, report: PnlReport | null = null): { context: () => UserContext } {
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
        ...(report ? { walletPnl: pnlContext(report) } : {}),
      }),
    }),
    [paper.account.cash, paper.equity, paper.account.realizedPnl, paper.positions, wallets, portfolios, report],
  );
}
