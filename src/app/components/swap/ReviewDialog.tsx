import { ArrowSquareOut, CheckCircle, CircleNotch, ShieldCheck, Warning, XCircle } from '@phosphor-icons/react';
import { extraNative, PROVIDER_LABELS } from '../../swap/aggregate';
import { formatAmount } from '../../swap/amount';
import { chainById } from '../../swap/chains';
import type { ExecResult, ExecStep } from '../../swap/execute';
import type { Plan, QuoteRequest } from '../../swap/types';
import { shortAddress } from '../../lib/format';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  req: QuoteRequest | null;
  plan: Plan | null;
  preparing: boolean;
  steps: ExecStep[];
  running: boolean;
  result: ExecResult | null;
  error: string | null;
  onConfirm: () => void;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-zinc-400">{k}</dt>
      <dd className="text-right text-white">{children}</dd>
    </div>
  );
}

export function ReviewDialog({ open, onOpenChange, req, plan, preparing, steps, running, result, error, onConfirm }: Props) {
  const from = req ? chainById(req.from.chainId) : undefined;
  const to = req ? chainById(req.to.chainId) : undefined;
  const crossChain = req ? req.from.chainId !== req.to.chainId : false;
  const extra = plan?.vm === 'evm' && req ? extraNative(plan, req) : 0n;
  const recipient = req?.recipient ?? req?.sender ?? '';

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{crossChain ? 'Review bridge' : 'Review swap'}</DialogTitle>
          <DialogDescription>Check every line. Your wallet shows each step again before anything is signed.</DialogDescription>
        </DialogHeader>

        {req && (
          <dl className="panel-inset divide-y divide-white/[0.05] px-3.5 py-1.5">
            <Row k="You pay"><span className="num">{formatAmount(req.amount, req.from.decimals)} {req.from.symbol}</span><span className="block text-xs text-zinc-500">{from?.name}</span></Row>
            <Row k="You receive at least">
              {plan?.minOut != null ? <span className="num">{formatAmount(plan.minOut, req.to.decimals)} {req.to.symbol}</span> : <span className="text-zinc-400">Shown in your wallet</span>}
              <span className="block text-xs text-zinc-500">{to?.name}</span>
            </Row>
            <Row k="Paid out to"><span className="num">{shortAddress(recipient, 6, 6)}</span>{req.recipient && req.recipient !== req.sender && <span className="block text-xs text-amber-300">Not the sending wallet</span>}</Row>
            {plan && <Row k="Route">{PROVIDER_LABELS[plan.provider]}</Row>}
            {plan?.vm === 'evm' && plan.approval && (
              <Row k="Approval"><span className="num">Exactly {formatAmount(plan.approval.amount, req.from.decimals)} {req.from.symbol}</span><span className="block text-xs text-zinc-500">to {shortAddress(plan.approval.spender, 6, 4)}, the contract that runs the swap</span></Row>
            )}
            {extra > 0n && from && <Row k="Bridge fee in native coin"><span className="num">{formatAmount(extra, from.native.decimals)} {from.native.symbol}</span></Row>}
            <Row k="Arctos fee">None</Row>
          </dl>
        )}

        {preparing && <p className="flex items-center gap-2 text-sm text-zinc-400"><CircleNotch className="h-4 w-4 animate-spin" aria-hidden />Getting a firm quote for your wallet…</p>}

        {steps.length > 0 && (
          <ol className="space-y-2" aria-label="Progress">
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 text-sm">
                {s.state === 'done' && <CheckCircle className="h-4.5 w-4.5 shrink-0 text-emerald-300" weight="fill" aria-label="Done" />}
                {s.state === 'active' && <CircleNotch className="h-4.5 w-4.5 shrink-0 animate-spin text-blue-300" aria-label="In progress" />}
                {s.state === 'failed' && <XCircle className="h-4.5 w-4.5 shrink-0 text-rose-300" weight="fill" aria-label="Failed" />}
                {s.state === 'waiting' && <span className="h-4.5 w-4.5 shrink-0 rounded-full border border-white/20" aria-label="Waiting" />}
                <span className={s.state === 'waiting' ? 'text-zinc-500' : 'text-zinc-200'}>{s.label}</span>
                {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">View <ArrowSquareOut className="h-3 w-3" aria-hidden /></a>}
              </li>
            ))}
          </ol>
        )}

        {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.08] p-3 text-sm text-rose-200"><Warning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
        {result && (
          <p role="status" className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${result.delivered ? 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200' : 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200'}`}>
            {result.delivered ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" aria-hidden /> : <Warning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>{result.delivered ? 'Done. The tokens are in the receiving wallet.' : result.note ?? 'Sent. It is still on its way.'}{result.link && <> <a href={result.link} target="_blank" rel="noopener noreferrer" className="underline">See the transaction</a>.</>}</span>
          </p>
        )}

        {!result && (
          <button type="button" onClick={onConfirm} disabled={!plan || running || preparing} className="btn btn-primary h-12 w-full text-[15px]">
            {running ? 'Waiting for your wallet…' : preparing ? 'Preparing…' : 'Confirm in wallet'}
          </button>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-zinc-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Arctos checks that the approval is exact and goes only to the contract that runs the swap, and that the route pays the address above.</p>
      </DialogContent>
    </Dialog>
  );
}
