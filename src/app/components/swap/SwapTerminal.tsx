import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowsDownUp, GearSix, ShieldWarning, SignOut, Wallet, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { checkEvmPlan, getQuotes, loadProviderContext, outputUnitUsd, outputUsd, PROVIDER_LABELS, providerById, type QuoteFailure } from '../../swap/aggregate';
import { amountToInput, cleanAmountInput, formatAmount, parseAmount, toNumber } from '../../swap/amount';
import { balanceOf, gasReserve } from '../../swap/balances';
import { chainById, chainByKey, isNative, SOLANA_ID, type SwapChain } from '../../swap/chains';
import { QuoteExpiredError, runPlan, walletMessage, warmRelay, type ExecResult, type ExecStep } from '../../swap/execute';
import { warmSolanaSigning } from '../../swap/solanaSign';
import { lookupOnChain, looksLikeAddress, nativeToken, sameToken, searchTokens } from '../../swap/tokens';
import type { Plan, ProviderContext, ProviderId, Quote, QuoteRequest, Token } from '../../swap/types';
import { useSwapWallets } from '../../swap/useSwapWallets';
import { useWalletHoldings } from '../../swap/useWalletHoldings';
import { isValidAddress, WALLET_OPTIONS, type WalletType } from '../../services/walletService';
import { sniperService, type Security } from '../../services/sniperService';
import { formatUsd, shortAddress } from '../../lib/format';
import { Card } from '../ui/common';
import { DexChart } from './DexChart';
import { QuoteList } from './QuoteList';
import { ReviewDialog } from './ReviewDialog';
import { TokenButton, TokenSelect } from './TokenSelect';

const USDC_SOL: Token = { chainId: SOLANA_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, verified: true };
const SLIPPAGE_KEY = 'arctos_swap_slippage_bps';
const HISTORY_KEY = 'arctos_swap_history';
const SLIPPAGE_PRESETS = [10, 50, 100, 300];
const REFRESH_MS = 20_000;
// How long a firm quote stays good enough to sign. Jupiter's signed order lives about a minute
// on chain, so it is kept much fresher than the EVM and bridge routes.
const FIRM_MAX_AGE: Record<Plan['vm'], number> = { svm: 12_000, evm: 30_000, relay: 25_000 };
// A fresh quote taken at the click may pay this much less than the one on screen (in basis
// points) before the user is asked to look again.
const PRICE_MOVE_BPS = 100n;
const RISK_CHAINS = new Set(['solana', 'bsc', 'ethereum', 'base', 'arbitrum']);
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'BUSD', 'USDC.E', 'USD1', 'PYUSD']);

interface HistoryItem {
  at: number;
  text: string;
  link: string | null;
  provider: ProviderId;
}

function readNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function readHistory(): HistoryItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((h) => h && typeof h.text === 'string' && typeof h.at === 'number').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* storage blocked */
  }
}

/**
 * Reads `#/trading?chain=..&token=..`, the link the sniper uses to open a token here.
 * `&side=sell` (from the wallet list) makes the token the one being paid with.
 */
function readDeepLink(): { chain: SwapChain; address: string; sell: boolean } | null {
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q === -1) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  const chain = chainByKey(params.get('chain') ?? '');
  const address = (params.get('token') ?? '').trim();
  const sell = params.get('side') === 'sell';
  if (!chain) return null;
  if (isNative(chain, address)) return { chain, address, sell };
  return looksLikeAddress(chain, address) ? { chain, address, sell } : null;
}

/** Hosts the swap panel calls straight from the browser. Opening connections early saves a round trip on the first quote. */
const WARM_HOSTS = [
  'https://api.relay.link',
  'https://api.jup.ag',
  'https://aggregator-api.kyberswap.com',
  'https://api.sushi.com',
  'https://api.dexscreener.com',
  'https://api.mainnet-beta.solana.com',
];

function warmConnections() {
  for (const href of WARM_HOSTS) {
    if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

export function SwapTerminal() {
  const wallets = useSwapWallets();
  const [ctx, setCtx] = useState<ProviderContext | null>(null);
  const [from, setFrom] = useState<Token>(() => nativeToken(chainById(SOLANA_ID) as SwapChain));
  const [to, setTo] = useState<Token | null>(USDC_SOL);
  const [amountText, setAmountText] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [slippageBps, setSlippageBps] = useState(() => Math.min(5000, readNumber(SLIPPAGE_KEY, 50)));
  const [showSettings, setShowSettings] = useState(false);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [evmMenu, setEvmMenu] = useState(false);
  const [chartSide, setChartSide] = useState<'to' | 'from' | null>(null);

  const [quotes, setQuotes] = useState<{ key: string; list: Quote[]; failures: QuoteFailure[]; loading: boolean }>({ key: '', list: [], failures: [], loading: false });
  const [selected, setSelected] = useState<ProviderId | null>(null);
  const [balance, setBalance] = useState<{ key: string; value: bigint | null } | null>(null);
  const [security, setSecurity] = useState<{ key: string; value: Security | null } | null>(null);
  const [riskAck, setRiskAck] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [plan, setPlan] = useState<{ plan: Plan; at: number; req: QuoteRequest } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ExecStep[]>([]);
  const [execError, setExecError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(readHistory);
  const [balanceTick, setBalanceTick] = useState(0);
  const held = useWalletHoldings([wallets.evm?.address, wallets.svm?.address], balanceTick);
  const runningRef = useRef(false);

  // Find the Solana wallet's signer early, so the wallet window opens the moment Confirm is pressed.
  useEffect(() => {
    if (wallets.svm) warmSolanaSigning();
  }, [wallets.svm]);

  useEffect(() => {
    warmConnections();
    const ctrl = new AbortController();
    loadProviderContext(ctrl.signal).then(setCtx).catch(() => {});
    return () => ctrl.abort();
  }, []);

  // Open a token straight from a link such as the sniper's "Swap" button.
  const openDeepLink = useCallback(async () => {
    const link = readDeepLink();
    if (!link || !ctx) return;
    const ctrl = new AbortController();
    const native = nativeToken(link.chain);
    const found = isNative(link.chain, link.address)
      ? native
      : (await searchTokens(ctx, link.chain, link.address, ctrl.signal).catch(() => []))[0] ?? (await lookupOnChain(link.chain, link.address).catch(() => null));
    if (!found) {
      toast.error('That token could not be found on chain.');
      return;
    }
    if (link.sell) {
      setFrom(found);
      setTo(sameToken(found, native) ? null : native);
      setAmountText('');
      setChartSide('from');
    } else {
      setFrom(native);
      setTo(sameToken(found, native) ? null : found);
      setChartSide('to');
    }
    setSelected(null);
  }, [ctx]);

  useEffect(() => {
    void openDeepLink();
    const onHash = () => void openDeepLink();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [openDeepLink]);

  const fromChain = chainById(from.chainId) as SwapChain;
  const toChain = to ? chainById(to.chainId) : undefined;
  const crossChain = Boolean(to && to.chainId !== from.chainId);
  const crossVm = Boolean(toChain && toChain.vm !== fromChain.vm);
  const senderWallet = fromChain.vm === 'evm' ? wallets.evm : wallets.svm;
  const sender = senderWallet?.address ?? null;
  const otherWallet = toChain ? (toChain.vm === 'evm' ? wallets.evm : wallets.svm) : null;

  const amount = parseAmount(amountText, from.decimals);
  const recipientInput = recipientText.trim();
  const recipient = !crossChain ? null : recipientInput || (crossVm ? otherWallet?.address ?? null : null);
  const recipientValid = !crossChain || (recipient ? isValidAddress(recipient, toChain?.vm === 'svm' ? 'solana' : 'evm') : !crossVm);

  const req: QuoteRequest | null = useMemo(() => {
    if (!to || !amount || sameToken(from, to)) return null;
    if (crossVm && (!recipient || !recipientValid)) {
      // Quote without a recipient is still useful before one is entered.
      return { from, to, amount, sender, recipient: null, slippageBps };
    }
    return { from, to, amount, sender, recipient: recipientValid ? recipient : null, slippageBps };
  }, [from, to, amount, sender, recipient, recipientValid, crossVm, slippageBps]);
  const reqKey = req ? [req.from.chainId, req.from.address, req.to.chainId, req.to.address, req.amount.toString(), req.sender, req.recipient, req.slippageBps].join('|') : '';

  // Quotes: debounced while typing, refreshed every 20 seconds while the page is visible.
  const quoteCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!req || !ctx || running || reviewOpen) return;
    const run = () => {
      quoteCtrl.current?.abort();
      const ctrl = new AbortController();
      quoteCtrl.current = ctrl;
      setQuotes((s) => (s.key === reqKey ? { ...s, loading: true } : { key: reqKey, list: [], failures: [], loading: true }));
      getQuotes(req, ctx, ctrl.signal)
        .then((r) => !ctrl.signal.aborted && setQuotes({ key: reqKey, list: r.quotes, failures: r.failures, loading: false }))
        .catch(() => !ctrl.signal.aborted && setQuotes((s) => ({ ...s, loading: false })));
    };
    const first = setTimeout(run, 450);
    const timer = setInterval(() => !document.hidden && run(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      quoteCtrl.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, ctx, running, reviewOpen]);

  const live = quotes.key === reqKey ? quotes : { key: reqKey, list: [], failures: [], loading: Boolean(req) };
  const quote = live.list.find((q) => q.provider === selected) ?? live.list[0] ?? null;

  // Balance of what the user pays with.
  const balanceKey = sender ? `${from.chainId}:${from.address}:${sender}:${balanceTick}` : '';
  useEffect(() => {
    if (!sender) return;
    const ctrl = new AbortController();
    balanceOf(from, sender, ctrl.signal).then((value) => !ctrl.signal.aborted && setBalance({ key: balanceKey, value }));
    return () => ctrl.abort();
  }, [balanceKey, from, sender]);
  // What the wallet holds, from the data service, shown at once; the chain read below confirms it.
  const heldFrom = (held.get(from.chainId) ?? []).find((h) => sameToken(h.token, from));
  const bal = balance?.key === balanceKey && balance.value != null ? balance.value : heldFrom?.raw ?? null;
  const short = bal != null && amount != null && amount > bal;

  // Contract risk for tokens that are not on a verified list.
  const riskToken = to && !to.verified ? to : !from.verified ? from : null;
  const riskChain = riskToken ? chainById(riskToken.chainId) : undefined;
  const riskKey = riskToken && riskChain && RISK_CHAINS.has(riskChain.key) && !isNative(riskChain, riskToken.address) ? `${riskChain.key}:${riskToken.address}` : '';
  useEffect(() => {
    setRiskAck(false);
    if (!riskKey || !riskChain || !riskToken) return;
    const ctrl = new AbortController();
    sniperService.security(riskChain.key, riskToken.address, ctrl.signal).then((value) => setSecurity({ key: riskKey, value })).catch(() => !ctrl.signal.aborted && setSecurity({ key: riskKey, value: null }));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskKey]);
  const risk = security?.key === riskKey ? security.value : null;
  const dangerous = Boolean(risk && (risk.isHoneypot || risk.riskScore >= 70));
  const bigImpact = quote?.impactPct != null && quote.impactPct < -15;
  const needsAck = Boolean(riskToken) || bigImpact;

  const setSlippage = (bps: number) => {
    const v = Math.min(5000, Math.max(1, Math.round(bps)));
    setSlippageBps(v);
    try {
      localStorage.setItem(SLIPPAGE_KEY, String(v));
    } catch {
      /* storage blocked */
    }
  };

  const flip = () => {
    if (!to) return;
    setFrom(to);
    setTo(from);
    setSelected(null);
    setRecipientText('');
  };

  const pickToken = (side: 'from' | 'to', t: Token) => {
    if (side === 'from') {
      if (to && sameToken(t, to)) setTo(from);
      setFrom(t);
      setAmountText((s) => cleanAmountInput(s, t.decimals));
    } else {
      if (sameToken(t, from)) setFrom(to ?? nativeToken(chainById(t.chainId) as SwapChain));
      setTo(t);
      setChartSide('to');
    }
    setSelected(null);
  };

  const setMax = () => {
    if (bal == null) return;
    const v = bal - gasReserve(from);
    setAmountText(v > 0n ? amountToInput(v, from.decimals) : '');
  };

  const connectFor = async (vm: 'evm' | 'svm', type?: WalletType) => {
    try {
      if (vm === 'svm') await wallets.connectSolanaWallet();
      else if (type) await wallets.connectEvmWallet(type);
      setEvmMenu(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The wallet could not connect.');
    }
  };

  const firmPlan = (q: Quote, firmReq: QuoteRequest, signal?: AbortSignal): Promise<Plan> =>
    providerById(q.provider)
      .plan(q, firmReq, ctx as ProviderContext, signal ?? new AbortController().signal)
      .then((p) => {
        if (p.vm === 'evm') checkEvmPlan(p, firmReq);
        return p;
      });

  const openReview = async () => {
    if (!req || !quote || !ctx || !sender) return;
    const firmReq: QuoteRequest = { ...req, sender, recipient: crossChain ? recipient : null };
    setReviewOpen(true);
    setPlan(null);
    setSteps([]);
    setExecError(null);
    setResult(null);
    setPreparing(true);
    if (fromChain.vm === 'svm') warmSolanaSigning();
    if (quote.provider === 'relay') warmRelay(ctx, fromChain.vm === 'svm');
    try {
      const p = await firmPlan(quote, firmReq);
      setPlan({ plan: p, at: Date.now(), req: firmReq });
    } catch (e) {
      setExecError(walletMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  // While the review is open and idle, keep the firm quote fresh in the background, so pressing
  // Confirm opens the wallet at once with a price that has not expired.
  const planAge = plan ? FIRM_MAX_AGE[plan.plan.vm] : 0;
  useEffect(() => {
    if (!reviewOpen || !plan || !quote || running || preparing || result) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      if (document.hidden || runningRef.current) return;
      firmPlan(quote, plan.req, ctrl.signal)
        .then((p) => !ctrl.signal.aborted && !runningRef.current && setPlan({ plan: p, at: Date.now(), req: plan.req }))
        .catch(() => {
          /* the next click fetches one anyway */
        });
    }, Math.max(1_000, planAge - 4_000 - (Date.now() - plan.at)));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOpen, plan, running, preparing, result]);

  const confirm = async () => {
    if (!plan || !ctx || runningRef.current) return;
    let current = plan;
    // A firm quote past its useful age is fetched again right before signing.
    if (Date.now() - plan.at > FIRM_MAX_AGE[plan.plan.vm] && quote) {
      setPreparing(true);
      setExecError(null);
      try {
        const p = await firmPlan(quote, plan.req);
        current = { plan: p, at: Date.now(), req: plan.req };
        setPlan(current);
      } catch (e) {
        setExecError(walletMessage(e));
        setPreparing(false);
        return;
      }
      setPreparing(false);
      const before = plan.plan.minOut;
      const after = current.plan.minOut;
      if (before != null && after != null && after * 10_000n < before * (10_000n - PRICE_MOVE_BPS)) {
        setExecError('The price moved while this was open. Check the new amount, then confirm again.');
        return;
      }
    }
    runningRef.current = true;
    setRunning(true);
    setExecError(null);
    try {
      const r = await runPlan(current.plan, current.req, ctx, { evm: wallets.evm, svm: wallets.svm }, setSteps);
      setResult(r);
      const text = `${formatAmount(current.req.amount, current.req.from.decimals)} ${current.req.from.symbol} to ${current.req.to.symbol}${crossChain ? ` on ${toChain?.name}` : ''}`;
      const next = [{ at: Date.now(), text, link: r.link, provider: current.plan.provider }, ...history].slice(0, 8);
      setHistory(next);
      saveHistory(next);
      setAmountText('');
      setBalanceTick((t) => t + 1);
      toast.success(r.delivered ? 'Swap complete' : 'Sent', { description: text });
    } catch (e) {
      setExecError(e instanceof Error ? e.message : 'Something went wrong. Nothing was sent.');
      if (e instanceof QuoteExpiredError && quote) {
        // Have a fresh price ready, so the next press goes straight to the wallet.
        firmPlan(quote, current.req)
          .then((p) => setPlan({ plan: p, at: Date.now(), req: current.req }))
          .catch(() => setPlan({ ...current, at: 0 }));
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  // What the main button says, and whether it can be pressed.
  const action: { label: string; onClick?: () => void; disabled: boolean } = (() => {
    if (!to) return { label: 'Choose a token to receive', disabled: true };
    if (sameToken(from, to)) return { label: 'Pick two different tokens', disabled: true };
    if (!amount) return { label: 'Enter an amount', disabled: true };
    if (!senderWallet) {
      return fromChain.vm === 'svm'
        ? { label: 'Connect Phantom', onClick: () => void connectFor('svm'), disabled: false }
        : { label: 'Connect an EVM wallet', onClick: () => setEvmMenu(true), disabled: false };
    }
    if (crossVm && !recipient) return { label: `Enter the ${toChain?.name} address to receive`, disabled: true };
    if (!recipientValid) return { label: 'That receiving address is not valid', disabled: true };
    if (short) return { label: `Not enough ${from.symbol}`, disabled: true };
    if (!quote) return { label: live.loading ? 'Finding the best route…' : 'No route found', disabled: true };
    if (needsAck && !riskAck) return { label: 'Confirm the warning below', disabled: true };
    return { label: crossChain ? 'Review bridge' : 'Review swap', onClick: () => void openReview(), disabled: false };
  })();

  const chartToken = chartSide === 'from' ? from : chartSide === 'to' ? to : to && STABLES.has(to.symbol.toUpperCase()) && !STABLES.has(from.symbol.toUpperCase()) ? from : to ?? from;
  const outUsd = quote && to ? outputUsd(quote, outputUnitUsd(live.list, to), to) : null;
  const rate = quote && amount ? toNumber(quote.amountOut, to?.decimals ?? 18) / toNumber(amount, from.decimals) : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="order-2 min-w-0 space-y-3 xl:order-1">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Chart</span>
          <div className="seg flex" role="tablist" aria-label="Chart token">
            {(['to', 'from'] as const).map((side) => {
              const t = side === 'to' ? to : from;
              return (
                <button key={side} type="button" role="tab" aria-selected={chartToken === t} disabled={!t} onClick={() => setChartSide(side)} className="seg-item px-3 py-1 text-xs font-medium">
                  {t?.symbol ?? '—'}
                </button>
              );
            })}
          </div>
        </div>
        <DexChart token={chartToken} />
      </div>

      <div className="order-1 space-y-4 xl:order-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{crossChain ? 'Bridge' : 'Swap'}</h2>
            <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} className="btn btn-ghost btn-sm gap-1.5 text-zinc-300">
              <GearSix className="h-4 w-4" aria-hidden /> {(slippageBps / 100).toFixed(slippageBps % 100 === 0 ? 0 : slippageBps % 10 === 0 ? 1 : 2)}% slippage
            </button>
          </div>

          {showSettings && (
            <div className="panel-inset mb-3 space-y-2 p-3">
              <p className="text-xs text-zinc-400">Most the price may move before your swap lands. Higher gets through on fast moving tokens, lower protects you.</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {SLIPPAGE_PRESETS.map((b) => (
                  <button key={b} type="button" aria-pressed={slippageBps === b} onClick={() => setSlippage(b)} className="seg-item rounded-lg border border-white/10 px-2.5 py-1 text-xs">{b / 100}%</button>
                ))}
                <label className="flex items-center gap-1 text-xs text-zinc-400">
                  <input type="number" min={0.01} max={50} step={0.1} value={slippageBps / 100} onChange={(e) => setSlippage(Number(e.target.value) * 100)} className="field num h-8 w-20 py-1 text-xs" aria-label="Custom slippage in percent" />%
                </label>
              </div>
              {slippageBps > 500 && <p className="text-xs text-amber-300">Above 5%, bots can take the difference from you. Use it only for tokens that need it.</p>}
            </div>
          )}

          <div className="panel-inset p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
              <span>You pay</span>
              {sender && (
                <span className="flex items-center gap-2">
                  Balance <span className="num text-zinc-200">{bal == null ? '…' : formatAmount(bal, from.decimals, 4)}</span>
                  {bal != null && bal > 0n && <button type="button" onClick={setMax} className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-200 hover:bg-white/[0.12]">Max</button>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" aria-label={`Amount of ${from.symbol} to pay`}
                value={amountText} onChange={(e) => setAmountText(cleanAmountInput(e.target.value, from.decimals))}
                className="num min-w-0 flex-1 bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-zinc-600"
              />
              <TokenButton token={from} onClick={() => setPicker('from')} label="Choose the token to pay with" />
            </div>
            {quote?.inUsd != null && <p className="num mt-1 text-xs text-zinc-500">≈ {formatUsd(quote.inUsd)}</p>}
          </div>

          <div className="relative z-10 -my-2.5 flex justify-center">
            <button type="button" onClick={flip} disabled={!to} aria-label="Swap the two tokens" className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-zinc-300 transition hover:border-blue-300/40 hover:text-white">
              {crossChain ? <ArrowDown className="h-4 w-4" aria-hidden /> : <ArrowsDownUp className="h-4 w-4" aria-hidden />}
            </button>
          </div>

          <div className="panel-inset p-3.5">
            <div className="mb-2 text-xs text-zinc-400">You receive{toChain && crossChain ? ` on ${toChain.name}` : ''}</div>
            <div className="flex items-center gap-3">
              <p className="num min-w-0 flex-1 truncate text-2xl font-semibold text-white" aria-live="polite">
                {quote && to ? formatAmount(quote.amountOut, to.decimals) : <span className="text-zinc-600">{live.loading && req ? '…' : '0.0'}</span>}
              </p>
              <TokenButton token={to} onClick={() => setPicker('to')} label="Choose the token to receive" />
            </div>
            {outUsd != null && <p className="num mt-1 text-xs text-zinc-500">≈ {formatUsd(outUsd)}{quote?.impactPct != null && <span className={quote.impactPct < -3 ? 'text-amber-300' : ''}> ({quote.impactPct.toFixed(2)}%)</span>}</p>}
          </div>

          {crossChain && (
            <label className="mt-3 block">
              <span className="label mb-1.5 block">Receiving address on {toChain?.name}</span>
              <input
                value={recipientText} onChange={(e) => setRecipientText(e.target.value.trim().slice(0, 64))} spellCheck={false} autoComplete="off"
                placeholder={crossVm ? (otherWallet?.address ? `Your ${toChain?.vm === 'svm' ? 'Phantom' : 'EVM'} wallet ${shortAddress(otherWallet.address)}` : toChain?.vm === 'svm' ? 'Solana address' : '0x address') : `Same wallet ${sender ? shortAddress(sender) : ''}`}
                className={`field num text-xs ${recipientInput && !recipientValid ? 'border-rose-400/50' : ''}`}
              />
              {recipientInput && recipientValid && <span className="mt-1 block text-[11px] text-amber-300">Double check this address. Funds sent to a wrong address cannot be recovered.</span>}
            </label>
          )}

          {quote && to && (
            <dl className="mt-3 space-y-1 px-0.5 text-xs">
              {rate != null && Number.isFinite(rate) && <div className="flex justify-between"><dt className="text-zinc-500">Rate</dt><dd className="num text-zinc-300">1 {from.symbol} = {rate < 0.0001 ? rate.toExponential(3) : rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to.symbol}</dd></div>}
              {quote.minOut != null && <div className="flex justify-between"><dt className="text-zinc-500">Minimum received</dt><dd className="num text-zinc-300">{formatAmount(quote.minOut, to.decimals)} {to.symbol}</dd></div>}
              {quote.feeNote && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Provider fee</dt><dd className="text-right text-zinc-300">{quote.feeNote}</dd></div>}
              <div className="flex justify-between"><dt className="text-zinc-500">Arctos fee</dt><dd className="text-zinc-300">None</dd></div>
            </dl>
          )}

          {riskToken && (
            <div className={`mt-3 rounded-xl border p-3 text-xs ${dangerous ? 'border-rose-400/30 bg-rose-400/[0.08] text-rose-200' : 'border-amber-400/25 bg-amber-400/[0.07] text-amber-200'}`}>
              <p className="flex items-center gap-1.5 font-semibold"><ShieldWarning className="h-4 w-4" aria-hidden />{riskToken.symbol} is not on a verified list</p>
              {risk?.available ? (
                <p className="mt-1">
                  {risk.isHoneypot ? 'Flagged as a honeypot: you may not be able to sell it. ' : `Risk score ${risk.riskScore} of 100. `}
                  {risk.sellTaxPct != null && risk.sellTaxPct > 0 && `Sell tax ${risk.sellTaxPct}%. `}
                  {risk.flags.slice(0, 3).join(', ')}
                </p>
              ) : (
                <p className="mt-1">Check the contract before you swap. Anyone can create a token with any name.</p>
              )}
              <label className="mt-2 flex items-center gap-2 text-zinc-200">
                <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                I checked this token and accept the risk
              </label>
            </div>
          )}
          {!riskToken && bigImpact && (
            <label className="mt-3 flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.08] p-3 text-xs text-rose-200">
              <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} className="h-4 w-4 accent-rose-400" />
              Price impact is {quote?.impactPct?.toFixed(1)}%. I accept losing that much to the pool.
            </label>
          )}

          <button type="button" onClick={action.onClick} disabled={action.disabled} className="btn btn-primary mt-4 h-12 w-full text-[15px]">
            {action.label}
          </button>

          {evmMenu && !wallets.evm && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {WALLET_OPTIONS.map((w) => (
                <button key={w.id} type="button" onClick={() => void connectFor('evm', w.id)} className="btn btn-secondary btn-sm">{w.name}</button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-xs">
            <Wallet className="h-4 w-4 text-violet-300" aria-hidden />
            {wallets.evm ? (
              <span className="flex items-center gap-1 rounded-lg bg-white/[0.05] px-2 py-1 text-zinc-200">EVM <span className="num">{shortAddress(wallets.evm.address)}</span>
                <button type="button" onClick={() => wallets.disconnect('evm')} aria-label="Disconnect EVM wallet" className="text-zinc-500 hover:text-rose-300"><SignOut className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <button type="button" onClick={() => setEvmMenu((v) => !v)} className="rounded-lg border border-white/10 px-2 py-1 text-zinc-300 hover:border-white/25">Connect EVM</button>
            )}
            {wallets.svm ? (
              <span className="flex items-center gap-1 rounded-lg bg-white/[0.05] px-2 py-1 text-zinc-200">Solana <span className="num">{shortAddress(wallets.svm.address)}</span>
                <button type="button" onClick={() => wallets.disconnect('svm')} aria-label="Disconnect Solana wallet" className="text-zinc-500 hover:text-rose-300"><SignOut className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <button type="button" onClick={() => void connectFor('svm')} className="rounded-lg border border-white/10 px-2 py-1 text-zinc-300 hover:border-white/25">Connect Phantom</button>
            )}
          </div>
        </Card>

        {req && to && (
          <Card className="p-4">
            <QuoteList quotes={live.list} failures={live.failures} to={to} selected={selected} onSelect={setSelected} loading={live.loading} />
            {!live.loading && live.list.length === 0 && live.failures.length > 0 && <p className="mt-2 text-xs text-zinc-500">Try a larger amount, another token, or a higher slippage.</p>}
            {ctx && (!ctx.zerox || !ctx.squid) && (
              <p className="mt-3 text-[11px] text-zinc-500">{[!ctx.zerox && '0x', !ctx.squid && 'Squid'].filter(Boolean).join(' and ')} {!ctx.zerox && !ctx.squid ? 'are' : 'is'} not switched on for this site yet.</p>
            )}
          </Card>
        )}

        {history.length > 0 && (
          <Card className="p-4">
            <h3 className="eyebrow mb-2">Your recent swaps on this device</h3>
            <ul className="space-y-1.5 text-xs">
              {history.map((h) => (
                <li key={h.at} className="flex items-center justify-between gap-2 text-zinc-300">
                  <span className="truncate">{h.text} <span className="text-zinc-500">via {PROVIDER_LABELS[h.provider] ?? h.provider}</span></span>
                  {h.link && /^https:\/\//.test(h.link) && <a href={h.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-blue-300 hover:text-blue-200">View</a>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-zinc-500">
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Real swaps with your own funds, signed in your own wallet. Arctos compares Relay, Jupiter, KyberSwap, 0x, Sushi and Squid, adds no fee and never holds your tokens. Spot only, no margin or perpetuals.
        </p>
      </div>

      <TokenSelect open={picker !== null} onOpenChange={(o) => !o && setPicker(null)} ctx={ctx} initialChainId={picker === 'to' ? to?.chainId ?? from.chainId : from.chainId} title={picker === 'to' ? 'Receive' : 'Pay with'} onPick={(t) => picker && pickToken(picker, t)} held={held} />
      <ReviewDialog
        open={reviewOpen} onOpenChange={(o) => { setReviewOpen(o); if (!o) { setSteps([]); setResult(null); setExecError(null); } }}
        req={plan?.req ?? req} plan={plan?.plan ?? null} preparing={preparing} steps={steps} running={running} result={result} error={execError} onConfirm={() => void confirm()}
      />
    </div>
  );
}
