// A one token swap opened from elsewhere in the app (the sniper's wallet mode): it finds the
// best route, shows the same review screen as the Trading Terminal, and signs in the user's
// own wallet. Loaded only when it is used.

import { useEffect, useRef, useState } from 'react';
import { checkEvmPlan, getQuotes, loadProviderContext, providerById } from '../../swap/aggregate';
import { formatAmount, parseAmount } from '../../swap/amount';
import { balanceOf, gasReserve } from '../../swap/balances';
import { chainByKey, type SwapChain } from '../../swap/chains';
import { QuoteExpiredError, runPlan, walletMessage, warmRelay, type ExecResult, type ExecStep } from '../../swap/execute';
import { warmSolanaSigning } from '../../swap/solanaSign';
import { lookupOnChain, nativeToken } from '../../swap/tokens';
import type { Plan, ProviderContext, Quote, QuoteRequest, Token } from '../../swap/types';
import type { SwapWallets } from '../../swap/useSwapWallets';
import { ReviewDialog } from './ReviewDialog';

export interface QuickSwapRequest {
  side: 'buy' | 'sell';
  chainKey: string;
  address: string;
  symbol: string;
  name: string;
  /** For a buy: how much of the chain's native coin to spend, as typed. */
  spend?: string;
  /** For a sell: the share of the wallet's balance to sell, from 0 to 1. */
  fraction?: number;
  slippageBps: number;
}

export interface QuickSwapDone {
  request: QuickSwapRequest;
  result: ExecResult;
  quote: Quote;
  req: QuoteRequest;
}

const FIRM_MAX_AGE: Record<Plan['vm'], number> = { svm: 12_000, evm: 30_000, relay: 25_000 };

let ctxPromise: Promise<ProviderContext> | null = null;
function context(): Promise<ProviderContext> {
  if (!ctxPromise) {
    ctxPromise = loadProviderContext(new AbortController().signal);
    ctxPromise.catch(() => {
      ctxPromise = null;
    });
  }
  return ctxPromise;
}

async function resolveToken(chain: SwapChain, r: QuickSwapRequest): Promise<Token> {
  const onChain = await lookupOnChain(chain, r.address).catch(() => null);
  if (!onChain) throw new Error(`${r.symbol} could not be read on ${chain.name}.`);
  return { ...onChain, symbol: r.symbol.slice(0, 16) || onChain.symbol, name: r.name.slice(0, 48) || onChain.name };
}

export default function QuickSwap({ request, wallets, onClose, onDone }: {
  request: QuickSwapRequest;
  wallets: SwapWallets;
  onClose: () => void;
  onDone: (done: QuickSwapDone) => void;
}) {
  const [open, setOpen] = useState(true);
  const [req, setReq] = useState<QuoteRequest | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [plan, setPlan] = useState<{ plan: Plan; at: number } | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ExecStep[]>([]);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<ProviderContext | null>(null);
  const runningRef = useRef(false);

  // Route, firm quote and checks, as soon as the dialog opens.
  useEffect(() => {
    let live = true;
    (async () => {
      const chain = chainByKey(request.chainKey);
      if (!chain) throw new Error('Arctos cannot swap on this chain yet. Use the paper account for it.');
      const wallet = chain.vm === 'svm' ? wallets.svm : wallets.evm;
      if (!wallet) throw new Error(`Connect ${chain.vm === 'svm' ? 'Phantom' : 'an EVM wallet'} first.`);
      if (chain.vm === 'svm') warmSolanaSigning();
      const [ctx, token] = await Promise.all([context(), resolveToken(chain, request)]);
      ctxRef.current = ctx;
      const native = nativeToken(chain);
      let from: Token;
      let to: Token;
      let amount: bigint;
      if (request.side === 'buy') {
        from = native;
        to = token;
        const spend = parseAmount(request.spend ?? '', native.decimals);
        if (!spend) throw new Error(`Set how much ${native.symbol} to spend.`);
        const have = await balanceOf(native, wallet.address);
        if (have != null && have < spend + gasReserve(native)) {
          throw new Error(`Not enough ${native.symbol}: the wallet has ${formatAmount(have, native.decimals, 4)} and the buy needs ${request.spend} plus the network fee.`);
        }
        amount = spend;
      } else {
        from = token;
        to = native;
        const have = await balanceOf(token, wallet.address);
        if (have == null) throw new Error(`The ${token.symbol} balance could not be read. Try again.`);
        if (have === 0n) throw new Error(`This wallet holds no ${token.symbol}.`);
        const share = Math.min(1, Math.max(0, request.fraction ?? 1));
        amount = share >= 1 ? have : (have * BigInt(Math.round(share * 10_000))) / 10_000n;
        if (amount === 0n) throw new Error('That amount is too small to sell.');
      }
      const firmReq: QuoteRequest = { from, to, amount, sender: wallet.address, recipient: null, slippageBps: request.slippageBps };
      const { quotes } = await getQuotes(firmReq, ctx, new AbortController().signal);
      if (quotes.length === 0) throw new Error('No route found for this token right now. It may have too little liquidity.');
      // Best route first; if it cannot build a transaction for this wallet, the next one is tried.
      let lastError: unknown = null;
      for (const q of quotes.slice(0, 3)) {
        try {
          if (q.provider === 'relay') warmRelay(ctx, chain.vm === 'svm');
          const p = await providerById(q.provider).plan(q, firmReq, ctx, new AbortController().signal);
          if (p.vm === 'evm') checkEvmPlan(p, firmReq);
          if (!live) return;
          setReq(firmReq);
          setQuote(q);
          setPlan({ plan: p, at: Date.now() });
          return;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError ?? new Error('No route could be prepared.');
    })()
      .catch((e) => live && setError(walletMessage(e)))
      .finally(() => live && setPreparing(false));
    return () => {
      live = false;
    };
  }, [request, wallets.evm, wallets.svm]);

  const fresh = async (): Promise<{ plan: Plan; at: number } | null> => {
    if (!plan || !quote || !req || !ctxRef.current) return null;
    if (Date.now() - plan.at <= FIRM_MAX_AGE[plan.plan.vm]) return plan;
    const p = await providerById(quote.provider).plan(quote, req, ctxRef.current, new AbortController().signal);
    if (p.vm === 'evm') checkEvmPlan(p, req);
    const next = { plan: p, at: Date.now() };
    setPlan(next);
    return next;
  };

  const confirm = async () => {
    if (!req || !quote || !ctxRef.current || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const current = await fresh();
      if (!current) return;
      const r = await runPlan(current.plan, req, ctxRef.current, { evm: wallets.evm, svm: wallets.svm }, setSteps);
      setResult(r);
      onDone({ request, result: r, quote, req });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was sent.');
      if (e instanceof QuoteExpiredError) setPlan((p) => (p ? { ...p, at: 0 } : p));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <ReviewDialog
      open={open}
      onOpenChange={(o) => {
        if (running) return;
        setOpen(o);
        if (!o) onClose();
      }}
      req={req}
      plan={plan?.plan ?? null}
      preparing={preparing}
      steps={steps}
      running={running}
      result={result}
      error={error}
      onConfirm={() => void confirm()}
    />
  );
}
