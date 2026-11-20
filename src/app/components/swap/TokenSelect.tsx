import { useEffect, useMemo, useState } from 'react';
import { CaretDown, CheckCircle, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import { chainById, CHAINS, isNative, type SwapChain } from '../../swap/chains';
import { featuredTokens, looksLikeAddress, nativeToken, searchTokens } from '../../swap/tokens';
import type { ProviderContext, Token } from '../../swap/types';
import { shortAddress } from '../../lib/format';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export function TokenLogo({ token, size = 28 }: { token: Token; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (token.logo && !broken) {
    return <img src={token.logo} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white/5" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400/30 to-violet-400/30 text-[10px] font-bold text-white" style={{ width: size, height: size }} aria-hidden>
      {token.symbol.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** The button inside the pay and receive boxes. */
export function TokenButton({ token, onClick, label }: { token: Token | null; onClick: () => void; label: string }) {
  const chain = token ? chainById(token.chainId) : undefined;
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-1.5 pr-2.5 text-left transition hover:border-white/25 hover:bg-white/[0.09]">
      {token ? <TokenLogo token={token} size={30} /> : <span className="h-[30px] w-[30px] rounded-full bg-white/10" />}
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-white">{token?.symbol ?? 'Select'}</span>
        <span className="block text-[11px] leading-tight text-zinc-400">{chain?.name ?? 'token'}</span>
      </span>
      <CaretDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
    </button>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: ProviderContext | null;
  initialChainId: number;
  title: string;
  onPick: (token: Token) => void;
}

export function TokenSelect({ open, onOpenChange, ctx, initialChainId, title, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pick a chain, then search by name, symbol or paste a contract address.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts fresh on the current chain. */}
        <Picker ctx={ctx} initialChainId={initialChainId} onPick={(t) => { onPick(t); onOpenChange(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function Picker({ ctx, initialChainId, onPick }: { ctx: ProviderContext | null; initialChainId: number; onPick: (t: Token) => void }) {
  const [chainId, setChainId] = useState(initialChainId);
  const [text, setText] = useState('');
  const [featured, setFeatured] = useState<Map<number, Token[]>>(new Map());
  const [results, setResults] = useState<{ q: string; list: Token[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const chain = chainById(chainId) as SwapChain;

  useEffect(() => {
    if (!ctx) return;
    const ctrl = new AbortController();
    featuredTokens(ctx, ctrl.signal).then(setFeatured).catch(() => {});
    return () => ctrl.abort();
  }, [ctx]);

  const q = text.trim();
  useEffect(() => {
    if (!ctx || q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      searchTokens(ctx, chain, q, ctrl.signal)
        .then((list) => setResults({ q: `${chain.id}:${q}`, list }))
        .catch(() => !ctrl.signal.aborted && setResults({ q: `${chain.id}:${q}`, list: [] }))
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [ctx, chain, q]);

  const list = useMemo(() => {
    if (q.length >= 2) return results?.q === `${chain.id}:${q}` ? results.list : [];
    return featured.get(chain.id) ?? [nativeToken(chain)];
  }, [q, results, featured, chain]);

  const pick = onPick;

  return (
    <>
        <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Chains">
          {CHAINS.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={c.id === chainId} onClick={() => { setChainId(c.id); setResults(null); }}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${c.id === chainId ? 'border-blue-300/50 bg-blue-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25'}`}>
              {c.name}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">Search tokens</span>
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, 64))} placeholder={chain.vm === 'svm' ? 'Name, symbol or mint address' : 'Name, symbol or 0x address'} className="field pl-9" spellCheck={false} autoComplete="off" />
        </label>
        <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
          {searching && list.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Searching…</p>}
          {!searching && q.length >= 2 && list.length === 0 && (
            <p className="py-6 text-center text-sm text-zinc-500">
              {looksLikeAddress(chain, q) ? 'No token found at that address on this chain.' : 'Nothing found. Try the contract address.'}
            </p>
          )}
          {q.length < 2 && <p className="eyebrow px-1 pb-1">Popular on {chain.name}</p>}
          {list.map((t) => (
            <button key={`${t.chainId}:${t.address}`} type="button" onClick={() => pick(t)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.06]">
              <TokenLogo token={t} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                  {t.symbol}
                  {t.verified ? <CheckCircle className="h-3.5 w-3.5 text-emerald-300" weight="fill" aria-label="On a verified list" /> : <Warning className="h-3.5 w-3.5 text-amber-300" weight="fill" aria-label="Not verified" />}
                </span>
                <span className="block truncate text-xs text-zinc-400">{t.name}</span>
              </span>
              <span className="num text-[11px] text-zinc-500">{isNative(chain, t.address) ? 'Native' : shortAddress(t.address)}</span>
            </button>
          ))}
        </div>
    </>
  );
}
