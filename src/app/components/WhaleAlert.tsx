import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowSquareOut, Bell, BellSlash, FunnelSimple, Plus, Star, Trash, Waves, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Card, Empty, ErrorNotice, Loading, PageHeader, Pill } from './ui/common';
import { usePolling } from '../hooks/usePolling';
import { openSocket } from '../services/api';
import { whaleService, type WhaleEvent, type WhaleKind } from '../services/whaleService';
import { isValidAddress } from '../services/walletService';
import { formatCompactUsd, formatNumber, safeHref, shortAddress, timeAgo } from '../lib/format';

const TRACKED_KEY = 'arctos_whales';
const NOTIFY_KEY = 'arctos_whale_notify';

interface TrackedWhale {
  id: string;
  address: string;
  name: string;
  dateAdded: string;
}

type KindFilter = 'all' | WhaleKind;

const KIND_LABEL: Record<WhaleKind, string> = { transfer: 'Transfer', exchange_inflow: 'To exchange', exchange_outflow: 'From exchange' };
const KIND_STYLE: Record<WhaleKind, string> = {
  transfer: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  exchange_inflow: 'bg-red-500/15 text-rose-300 border-red-500/30',
  exchange_outflow: 'bg-green-500/15 text-green-400 border-green-500/30',
};

function readTracked(): TrackedWhale[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TRACKED_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((w): w is TrackedWhale => Boolean(w) && typeof w.id === 'string' && typeof w.address === 'string' && typeof w.name === 'string' && typeof w.dateAdded === 'string');
  } catch {
    return [];
  }
}

function sameAddress(a: string | null, b: string) {
  return a != null && a.toLowerCase() === b.toLowerCase();
}

export function WhaleAlert() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [chain, setChain] = useState('all');
  const [minUsd, setMinUsd] = useState(100_000);
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [notify, setNotify] = useState(() => localStorage.getItem(NOTIFY_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [tracked, setTracked] = useState<TrackedWhale[]>(readTracked);
  const [showAdd, setShowAdd] = useState(false);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState('');
  const [pushed, setPushed] = useState<WhaleEvent[]>([]);
  const [, setClock] = useState(0);
  const notifyRef = useRef(notify);
  const minRef = useRef(minUsd);

  const data = usePolling((s) => whaleService.list({ minUsd: 100_000, limit: 300 }, s), 15_000);

  useEffect(() => { notifyRef.current = notify; }, [notify]);
  useEffect(() => { minRef.current = minUsd; }, [minUsd]);
  useEffect(() => {
    try { localStorage.setItem(TRACKED_KEY, JSON.stringify(tracked)); } catch { /* storage unavailable */ }
  }, [tracked]);
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 30_000); // keep "5m ago" labels fresh
    return () => clearInterval(t);
  }, []);

  // New transfers arrive over a WebSocket as soon as the server sees them.
  useEffect(() => {
    return openSocket('/ws/whales', (msg) => {
      const m = msg as { type?: string; data?: WhaleEvent };
      if (m.type !== 'whale' || !m.data) return;
      const ev = m.data;
      setPushed((prev) => [ev, ...prev].slice(0, 100));
      if (notifyRef.current && ev.valueUsd >= minRef.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`${formatCompactUsd(ev.valueUsd)} ${ev.asset} moved on ${ev.chainName}`, {
          body: ev.fromLabel || ev.toLabel ? `${ev.fromLabel ?? 'Wallet'} to ${ev.toLabel ?? 'wallet'}` : 'Large on chain transfer',
        });
      }
    });
  }, []);

  const events = useMemo(() => {
    const byId = new Map<string, WhaleEvent>();
    for (const e of data.data?.events ?? []) byId.set(e.id, e);
    for (const e of pushed) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [data.data, pushed]);

  const isTracked = useCallback((addr: string | null) => addr != null && tracked.some((w) => sameAddress(addr, w.address)), [tracked]);
  const nameOf = (addr: string | null) => tracked.find((w) => sameAddress(addr, w.address))?.name;

  const filtered = useMemo(() => events.filter((e) => {
    if (e.valueUsd < minUsd) return false;
    if (kind !== 'all' && e.kind !== kind) return false;
    if (chain !== 'all' && e.chain !== chain) return false;
    if (trackedOnly && !isTracked(e.from) && !isTracked(e.to)) return false;
    return true;
  }), [events, minUsd, kind, chain, trackedOnly, isTracked]);

  const stats = useMemo(() => {
    const total = filtered.reduce((s, e) => s + e.valueUsd, 0);
    return { count: filtered.length, largest: filtered.reduce((m, e) => Math.max(m, e.valueUsd), 0), average: filtered.length ? total / filtered.length : 0 };
  }, [filtered]);

  const toggleNotify = async () => {
    if (notify) {
      setNotify(false);
      localStorage.setItem(NOTIFY_KEY, '0');
      return;
    }
    if (typeof Notification === 'undefined') return toast.error('This browser does not support notifications.');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return toast.error('Notifications are blocked. Allow them in your browser settings to use alerts.');
    setNotify(true);
    localStorage.setItem(NOTIFY_KEY, '1');
    toast.success('You will get a browser alert for new transfers above your minimum.');
  };

  const addWhale = () => {
    const addr = address.trim();
    const name = label.trim();
    if (!isValidAddress(addr, 'evm') && !isValidAddress(addr, 'solana')) return setFormError('Enter a valid Ethereum style (0x...) or Solana address.');
    if (!name) return setFormError('Give the wallet a label.');
    if (tracked.some((w) => sameAddress(addr, w.address))) return setFormError('You already track this address.');
    setTracked((prev) => [...prev, { id: crypto.randomUUID(), address: addr, name: name.slice(0, 40), dateAdded: new Date().toISOString() }]);
    setAddress(''); setLabel(''); setFormError(''); setShowAdd(false);
  };

  const chains = data.data?.chains ?? [];
  const input = 'w-full bg-white/[0.06] text-white text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:border-blue-500 focus:outline-none';

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1500px] mx-auto">
      <PageHeader
        icon={<Waves />} tone="ice" title="Whale Alerts"
        subtitle="Large on chain transfers, read straight from the blockchains"
        actions={
          <>
            <button onClick={toggleNotify} aria-pressed={notify} className={`btn h-10 ${notify ? 'border border-blue-300/40 bg-blue-400/15 text-blue-100' : 'btn-secondary'}`}>
              {notify ? <Bell className="w-4 h-4" aria-hidden /> : <BellSlash className="w-4 h-4" aria-hidden />} Browser alerts {notify ? 'on' : 'off'}
            </button>
            <button onClick={() => { setShowAdd((v) => !v); setFormError(''); }} className="btn btn-primary h-10">
              <Plus className="w-4 h-4" aria-hidden /> Track wallet
            </button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {chains.map((c) => (
          <span key={c.chain} title={c.note}>
            <Pill tone={!c.supported ? 'zinc' : c.ok ? 'green' : 'amber'}>
              <span className={`w-1.5 h-1.5 rounded-full ${!c.supported ? 'bg-zinc-500' : c.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {c.name}{!c.supported ? ': not available yet' : c.ok ? '' : ': delayed'}
            </Pill>
          </span>
        ))}
      </div>

      {showAdd && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4"><h2 className="text-white font-semibold">Track a wallet</h2><button onClick={() => setShowAdd(false)} aria-label="Close" className="p-1.5 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button></div>
          <div className="grid sm:grid-cols-2 gap-4 mb-3">
            <label className="block"><span className="block text-zinc-400 text-xs mb-1.5">Wallet address</span><input className={`${input} font-mono`} value={address} onChange={(e) => { setAddress(e.target.value); setFormError(''); }} placeholder="0x... or Solana address" /></label>
            <label className="block"><span className="block text-zinc-400 text-xs mb-1.5">Label</span><input className={input} value={label} maxLength={40} onChange={(e) => { setLabel(e.target.value); setFormError(''); }} placeholder="Smart money 1" /></label>
          </div>
          {formError && <p role="alert" className="text-sm text-rose-300 mb-3">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={addWhale} className="btn btn-primary px-5 py-2">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-5 py-2 bg-white/[0.06] text-zinc-300 rounded-lg hover:bg-white/[0.1] text-sm">Cancel</button>
          </div>
          <p className="text-xs text-zinc-500 mt-3">Tracked wallets are saved in this browser. Their transfers are highlighted when they appear in the feed.</p>
        </Card>
      )}

      {tracked.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold flex items-center gap-2"><Star className="w-4 h-4 text-amber-300" aria-hidden /> Tracked wallets <span className="text-xs bg-white/[0.06] text-zinc-400 px-2 py-0.5 rounded-full">{tracked.length}</span></h2>
            <button onClick={() => setTrackedOnly((v) => !v)} aria-pressed={trackedOnly} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${trackedOnly ? 'border border-blue-300/40 bg-blue-400/15 text-blue-100' : 'border border-white/[0.07] bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white'}`}>{trackedOnly ? 'Showing tracked only' : 'Show tracked only'}</button>
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tracked.map((w) => (
              <li key={w.id} className="flex items-start justify-between gap-3 p-3 bg-white/[0.06] rounded-lg border border-white/10">
                <div className="min-w-0"><p className="text-white text-sm font-semibold truncate">{w.name}</p><p className="text-zinc-400 text-xs font-mono truncate">{w.address}</p></div>
                <button onClick={() => setTracked((p) => p.filter((x) => x.id !== w.id))} aria-label={`Stop tracking ${w.name}`} className="p-1.5 text-zinc-500 hover:text-rose-300"><Trash className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Transfers shown', String(stats.count)], ['Largest', formatCompactUsd(stats.largest)], ['Average', formatCompactUsd(stats.average)], ['Tracked wallets', String(tracked.length)]].map(([k, v]) => (
          <Card key={k} className="p-4"><p className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider mb-1">{k}</p><p className="text-xl font-semibold text-white num">{v}</p></Card>
        ))}
      </div>

      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-zinc-400 text-sm font-medium"><FunnelSimple className="w-4 h-4 text-zinc-500" aria-hidden /> Filters</span>
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Transfer type">
            {([['all', 'All'], ['transfer', 'Transfers'], ['exchange_inflow', 'To exchange'], ['exchange_outflow', 'From exchange']] as const).map(([id, text]) => (
              <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${kind === id ? 'border border-blue-300/40 bg-blue-400/15 text-blue-100' : 'border border-white/[0.07] bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white'}`}>{text}</button>
            ))}
          </div>
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            <label className="flex items-center gap-2 text-zinc-500 text-xs">Chain
              <select value={chain} onChange={(e) => setChain(e.target.value)} className="bg-white/[0.06] text-white text-xs px-3 py-1.5 rounded-lg border border-white/10">
                <option value="all">All chains</option>
                {chains.filter((c) => c.supported).map((c) => <option key={c.chain} value={c.chain}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-zinc-500 text-xs">Minimum
              <select value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))} className="bg-white/[0.06] text-white text-xs px-3 py-1.5 rounded-lg border border-white/10">
                {[100_000, 500_000, 1_000_000, 5_000_000].map((v) => <option key={v} value={v}>{formatCompactUsd(v)}+</option>)}
              </select>
            </label>
          </div>
        </div>
      </Card>

      {data.error && <ErrorNotice message={data.error} onRetry={data.refresh} />}

      <Card className="overflow-hidden">
        {data.loading && !data.data ? <Loading label="Reading the chains" />
        : filtered.length === 0 ? (
          <Empty title="No transfers match these filters yet">
            {events.length === 0 ? 'The tracker has just started. Large transfers appear here as new blocks arrive.' : 'Try a lower minimum or another chain.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04] border-b border-white/10 text-left text-zinc-500 text-xs uppercase tracking-wide">
                  {['Type', 'Asset', 'Amount', 'Value', 'From and to', 'Chain', 'Time', ''].map((h) => <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filtered.slice(0, 150).map((e) => {
                  const hit = isTracked(e.from) || isTracked(e.to);
                  const href = safeHref(e.explorerUrl);
                  const side = (addr: string | null, lbl: string | null) => {
                    const mine = nameOf(addr);
                    if (mine) return <span className="text-yellow-400 font-semibold"><Star className="w-2.5 h-2.5 inline fill-yellow-400 mr-0.5" aria-hidden />{mine}</span>;
                    if (lbl) return <span className="text-zinc-200 font-medium">{lbl}</span>;
                    return <span className="font-mono text-zinc-500">{addr ? shortAddress(addr) : 'Unknown'}</span>;
                  };
                  return (
                    <tr key={e.id} className={hit ? 'bg-amber-400/[0.06] hover:bg-amber-400/10' : 'hover:bg-white/[0.04]'}>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-semibold ${KIND_STYLE[e.kind]}`}>{KIND_LABEL[e.kind]}</span></td>
                      <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{e.asset}</td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap num">{formatNumber(e.amount, e.amount >= 1000 ? 0 : 3)}</td>
                      <td className="px-4 py-3 text-white font-semibold whitespace-nowrap num">{formatCompactUsd(e.valueUsd)}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-1.5 text-xs">{side(e.from, e.fromLabel)}<ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />{side(e.to, e.toLabel)}</div></td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className="px-2 py-0.5 bg-white/[0.06] text-zinc-400 rounded text-xs">{e.chainName}</span></td>
                      <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">{timeAgo(e.timestamp)}</td>
                      <td className="px-4 py-3">{href && <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${e.asset} transfer on a block explorer`} className="inline-flex p-1.5 text-zinc-500 hover:text-white rounded"><ArrowSquareOut className="w-3.5 h-3.5" /></a>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-zinc-500">Direction labels only appear when a wallet matches a short built in list of well known exchange wallets. Bitcoin transfers show total outputs and do not include wallet addresses.</p>
    </div>
  );
}
