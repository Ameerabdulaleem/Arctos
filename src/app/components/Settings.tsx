import { useRef, useState } from 'react';
import { CheckCircle2, Download, Settings as SettingsIcon, Trash2, Upload, Wallet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, ErrorNotice, Loading, PageHeader, Pill } from './ui/common';
import { useAuth } from '../contexts/auth-context';
import { usePaper } from '../contexts/paper-context';
import { usePolling } from '../hooks/usePolling';
import { statusService } from '../services/statusService';
import { parseTrades, TRADEBOOK_KEY } from '../lib/tradebook';
import { sanitizeAccount } from '../lib/paperTrading';
import { formatUsd, shortAddress, timeAgo } from '../lib/format';

const DATA_KEYS = ['arctos_tradebook', 'arctos_paper_v1', 'arctos_whales', 'arctos_sniper_filters', 'arctos_sniper_tracked', 'arctos_sniper_auto_done', 'arctos_whale_notify'];

export function Settings({ onConnectWallet }: { onConnectWallet: () => void }) {
  const { user, isAuthenticated, isWalletConnected, disconnectWallet, signOut } = useAuth();
  const paper = usePaper();
  const status = usePolling((s) => statusService.get(s), 30_000);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const exportData = () => {
    const bundle: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: 'arctos' };
    for (const key of DATA_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) bundle[key] = JSON.parse(raw);
      } catch { /* skip unreadable entries */ }
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `arctos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error('That file is too large.');
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      let restored = 0;
      const trades = parseTrades(data[TRADEBOOK_KEY]);
      if (trades.length) { localStorage.setItem(TRADEBOOK_KEY, JSON.stringify(trades)); restored++; }
      const account = sanitizeAccount(data.arctos_paper_v1);
      if (account) { localStorage.setItem('arctos_paper_v1', JSON.stringify(account)); restored++; }
      if (Array.isArray(data.arctos_whales)) { localStorage.setItem('arctos_whales', JSON.stringify(data.arctos_whales)); restored++; }
      if (restored === 0) throw new Error('No Arctos data was found in that file.');
      toast.success('Backup restored. Reloading...');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that backup file.');
    }
  };

  const clearAll = () => {
    for (const k of DATA_KEYS) localStorage.removeItem(k);
    toast.success('Local data cleared. Reloading...');
    setTimeout(() => window.location.reload(), 600);
  };

  const btn = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm text-white';

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader icon={<SettingsIcon className="w-5 h-5" />} title="Settings" subtitle="Data sources, account and local data" />

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-white">Data sources</h2>
          {status.data && <Pill tone="zinc">Service v{status.data.version}, up {Math.floor(status.data.uptimeSecs / 60)} min</Pill>}
        </div>
        {status.error && !status.data && <ErrorNotice message={status.error} onRetry={status.refresh} />}
        {status.loading && !status.data && <Loading label="Checking data sources" />}
        {status.data && (
          <>
            <ul className="divide-y divide-zinc-800/60">
              {status.data.sources.filter((s) => !s.name.startsWith('news:')).map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    {s.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-label="Working" /> : <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-label="Failing" />}
                    <span className="text-white font-medium">{s.name}</span>
                  </span>
                  <span className="text-xs text-zinc-500 text-right truncate">
                    {s.ok ? `${s.latencyMs ?? 0} ms, ${s.lastSuccess ? timeAgo(s.lastSuccess) : 'no data yet'}` : s.lastError ?? 'Not responding'}
                  </span>
                </li>
              ))}
              {status.data.sources.filter((s) => s.name.startsWith('news:')).length > 0 && (
                <li className="py-2.5 text-sm flex justify-between"><span className="text-white font-medium">News feeds</span>
                  <span className="text-xs text-zinc-500">{status.data.sources.filter((s) => s.name.startsWith('news:') && s.ok).length} of {status.data.sources.filter((s) => s.name.startsWith('news:')).length} responding</span></li>
              )}
            </ul>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
              {[['Live pairs', status.data.data.tickers], ['Coins', status.data.data.coins], ['Headlines', status.data.data.newsArticles], ['Whale transfers', status.data.data.whaleEvents]].map(([k, v]) => (
                <div key={String(k)} className="bg-zinc-800/50 rounded-lg px-3 py-2"><dt className="text-zinc-500">{k}</dt><dd className="text-white font-semibold tabular-nums text-base">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-zinc-500">
              AI assistant: {status.data.ai.configured ? 'configured' : 'not configured (set ANTHROPIC_API_KEY on the server)'}. Database: {status.data.database.connected ? 'connected' : status.data.database.configured ? 'configured but not reachable' : 'not configured (waitlist positions need it)'}.
            </p>
          </>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold text-white mb-4">Account and wallet</h2>
        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-zinc-300 flex items-center gap-2"><Wallet className="w-4 h-4 text-emerald-400" aria-hidden />
              {isWalletConnected ? <>Wallet <span className="font-mono">{shortAddress(user?.walletAddress, 8, 6)}</span> {user?.chainId ? `(chain ${user.chainId})` : ''}</> : <>Signed in as {user?.email}</>}
            </p>
            <button onClick={() => { if (isWalletConnected) disconnectWallet(); else signOut(); }} className={btn}>{isWalletConnected ? 'Disconnect wallet' : 'Sign out'}</button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap"><p className="text-sm text-zinc-400">No wallet connected.</p><button onClick={onConnectWallet} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm text-white">Connect wallet</button></div>
        )}
        <p className="text-xs text-zinc-500 mt-3">Arctos only reads your public address. It never asks for signatures, approvals or seed phrases.</p>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold text-white mb-1">Paper trading account</h2>
        <p className="text-sm text-zinc-400 mb-4">Equity {formatUsd(paper.equity)}, started with {formatUsd(paper.account.startingBalance, 0)}, {paper.account.fills.length} fills.</p>
        <button onClick={() => { paper.reset(); toast.success('Paper account reset to $10,000.'); }} className={btn}>Reset paper account</button>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold text-white mb-1">Your data</h2>
        <p className="text-sm text-zinc-400 mb-4">Your trade book, paper account, tracked wallets and sniper filters live in this browser only. Back them up or move them to another device.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={exportData} className={btn}><Download className="w-4 h-4" aria-hidden /> Export backup</button>
          <button onClick={() => fileRef.current?.click()} className={btn}><Upload className="w-4 h-4" aria-hidden /> Import backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = ''; }} />
          {confirmClear ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-red-300">Delete everything saved here?</span>
              <button onClick={clearAll} className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white">Yes, delete</button>
              <button onClick={() => setConfirmClear(false)} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmClear(true)} className={`${btn} text-red-300`}><Trash2 className="w-4 h-4" aria-hidden /> Clear local data</button>
          )}
        </div>
      </Card>
    </div>
  );
}
