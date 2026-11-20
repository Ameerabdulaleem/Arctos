import { useEffect, useState } from 'react';
import { ArrowDown, ArrowSquareOut, ArrowUp, Eye, Key, Lock, LockOpen, Vault, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { amountToInput, cleanAmountInput, formatAmount, parseAmount } from '../../swap/amount';
import { signSolanaTransaction } from '../../swap/solanaSign';
import {
  createSniperWallet, depositToSniper, exportSniperSecret, forgetSniperWallet, lockSniperWallet, markBackedUp, MIN_PASSWORD,
  onSniperWalletChange, sniperBalance, sniperWalletInfo, SOL_RESERVE, unlockSniperWallet, withdrawFromSniper, type SniperWalletInfo,
} from '../../swap/sniperWallet';
import type { SolanaWallet } from '../../swap/wallets';
import { shortAddress } from '../../lib/format';
import { Card, IconTile } from '../ui/common';
import { CopyAddress } from '../ui/CopyAddress';

const SOL = 9;

function useSniperWallet() {
  const [info, setInfo] = useState<SniperWalletInfo | null>(() => sniperWalletInfo());
  useEffect(() => onSniperWalletChange(() => setInfo(sniperWalletInfo())), []);
  return info;
}

/** The secret key, shown once after creation or on export, with a copy button. */
function SecretBox({ secret, onDone, done }: { secret: string; onDone: () => void; done: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3 text-xs text-amber-100">
      <p className="flex items-start gap-1.5 font-semibold"><Warning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Save this secret key somewhere safe and private.</p>
      <p>It is the only way to recover the sniper wallet if this browser's data is cleared. You can import it into Phantom (Add account, Import private key). Anyone who has it can take the funds, so never share it or paste it into a website.</p>
      <div className="flex items-center gap-2 rounded-lg bg-black/40 p-2">
        <code className="num min-w-0 flex-1 break-all text-[11px] text-zinc-100">{shown ? secret : '•'.repeat(44)}</code>
        <button type="button" onClick={() => setShown((s) => !s)} className="btn btn-ghost btn-icon h-8 w-8" aria-label={shown ? 'Hide the key' : 'Show the key'}><Eye className="h-4 w-4" /></button>
        <CopyAddress value={secret} label="Copy the secret key" size="sm" />
      </div>
      <button type="button" onClick={onDone} className="btn btn-primary btn-sm">{done}</button>
    </div>
  );
}

export function SniperWalletCard({ phantom, onConnectPhantom, solPriceUsd, onBalance }: {
  phantom: SolanaWallet | null;
  onConnectPhantom: () => void;
  solPriceUsd: number | null;
  /** Reports the balance, so the auto sniper knows the budget. */
  onBalance: (lamports: bigint | null) => void;
}) {
  const info = useSniperWallet();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [secret, setSecret] = useState<{ value: string; fresh: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [deposit, setDeposit] = useState('0.2');
  const [tick, setTick] = useState(0);

  const address = info?.address;
  useEffect(() => {
    if (!address) return;
    let live = true;
    const load = () => sniperBalance().then((b) => { if (live) { setBalance(b); onBalance(b); } }).catch(() => {});
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address, tick, onBalance]);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try {
      await job();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
      setTick((t) => t + 1);
    }
  };

  if (!info) {
    const valid = password.length >= MIN_PASSWORD && password === confirm;
    return (
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="violet" size="sm"><Vault /></IconTile>Create your sniper wallet</h2>
        <p className="text-xs leading-relaxed text-zinc-400">
          A separate Solana wallet for the sniper, kept only in this browser. You move a budget into it from Phantom, the sniper buys and sells with that budget without a popup for each trade, and you withdraw back to Phantom whenever you like. Your main wallet is never touched. Its key is encrypted with the password below and never leaves your device.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`Password, at least ${MIN_PASSWORD} characters`} className="field py-2" aria-label="Sniper wallet password" />
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat the password" className="field py-2" aria-label="Repeat the password" />
        </div>
        <p className="text-[11px] text-zinc-500">Arctos cannot recover this password. You will see the wallet's secret key once, to save as a backup.</p>
        <button type="button" disabled={!valid || busy !== null} onClick={() => void run('create', async () => {
          const r = await createSniperWallet(password);
          setPassword('');
          setConfirm('');
          setSecret({ value: r.secret, fresh: true });
        })} className="btn btn-primary">{busy === 'create' ? 'Creating…' : 'Create sniper wallet'}</button>
      </Card>
    );
  }

  const usable = balance != null && balance > SOL_RESERVE ? balance - SOL_RESERVE : 0n;
  const solUsd = (lamports: bigint) => (solPriceUsd ? ` (about $${((Number(lamports) / 1e9) * solPriceUsd).toFixed(2)})` : '');

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="violet" size="sm"><Vault /></IconTile>Sniper wallet</h2>
        <span className="flex items-center gap-1 text-xs text-zinc-400">
          <span className="num">{shortAddress(info.address, 5, 5)}</span><CopyAddress value={info.address} label="Copy the sniper wallet address" />
          <a href={`https://solscan.io/account/${info.address}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label="Open the sniper wallet on Solscan"><ArrowSquareOut className="h-3.5 w-3.5" /></a>
        </span>
      </div>

      {secret && (
        <SecretBox secret={secret.value} done={secret.fresh ? 'I saved the key' : 'Hide the key'} onDone={() => { if (secret.fresh) markBackedUp(); setSecret(null); }} />
      )}

      <div className="panel-inset p-3">
        <p className="eyebrow text-[10px]">Budget in the sniper wallet</p>
        <p className="num text-xl font-semibold text-white">{balance == null ? '…' : `${formatAmount(balance, SOL, 4)} SOL`}</p>
        <p className="text-[11px] text-zinc-500">{balance == null ? 'Reading the balance' : `${formatAmount(usable, SOL, 4)} SOL can be spent${solUsd(usable)}. ${formatAmount(SOL_RESERVE, SOL, 2)} SOL stays for network fees and token accounts.`}</p>
      </div>

      {!info.unlocked ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run('unlock', async () => { await unlockSniperWallet(password); setPassword(''); }); }}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password to unlock" className="field flex-1 py-2" aria-label="Sniper wallet password" />
          <button type="submit" disabled={!password || busy !== null} className="btn btn-primary"><LockOpen className="h-4 w-4" aria-hidden />{busy === 'unlock' ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="eyebrow">Deposit from Phantom</p>
            {phantom ? (
              <div className="flex gap-2">
                <span className="relative flex-1">
                  <input value={deposit} inputMode="decimal" onChange={(e) => setDeposit(cleanAmountInput(e.target.value, SOL))} className="field num py-2 pr-12" aria-label="SOL to deposit" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">SOL</span>
                </span>
                <button type="button" disabled={busy !== null || !parseAmount(deposit, SOL)} onClick={() => void run('deposit', async () => {
                  const lamports = parseAmount(deposit, SOL);
                  if (!lamports) return;
                  const sig = await depositToSniper(phantom.address, lamports, (bytes) => signSolanaTransaction(phantom.provider, phantom.address, bytes));
                  toast.success(`Deposited ${deposit} SOL`, { description: `Transaction ${shortAddress(sig, 6, 6)}` });
                })} className="btn btn-secondary"><ArrowDown className="h-4 w-4" aria-hidden />{busy === 'deposit' ? 'Waiting…' : 'Deposit'}</button>
              </div>
            ) : (
              <button type="button" onClick={onConnectPhantom} className="btn btn-secondary btn-sm">Connect Phantom to deposit</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null || !phantom || !balance} onClick={() => void run('withdraw', async () => {
              if (!phantom) return;
              const sig = await withdrawFromSniper(phantom.address);
              toast.success('Withdrawn to Phantom', { description: `Transaction ${shortAddress(sig, 6, 6)}` });
            })} className="btn btn-secondary btn-sm" title={phantom ? `Sends all SOL to ${shortAddress(phantom.address)}` : 'Connect Phantom first'}>
              <ArrowUp className="h-4 w-4" aria-hidden />{busy === 'withdraw' ? 'Sending…' : 'Withdraw all SOL to Phantom'}
            </button>
            <button type="button" onClick={() => lockSniperWallet()} className="btn btn-ghost btn-sm"><Lock className="h-4 w-4" aria-hidden />Lock</button>
          </div>
          {!info.backedUp && <p className="text-[11px] text-amber-200">You have not confirmed saving the secret key yet. Export it below and keep it safe.</p>}
          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer select-none text-zinc-300">Key and wallet options</summary>
            <div className="mt-2 space-y-2">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run('export', async () => { setSecret({ value: await exportSniperSecret(password), fresh: !info.backedUp }); setPassword(''); }); }}>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="field flex-1 py-1.5" aria-label="Password to export the key" />
                <button type="submit" disabled={!password || busy !== null} className="btn btn-secondary btn-sm"><Key className="h-4 w-4" aria-hidden />Export key</button>
              </form>
              <button type="button" disabled={busy !== null || (balance != null && balance > 0n)} onClick={() => {
                if (window.confirm('Remove the sniper wallet from this browser? Only do this after withdrawing its funds or saving its key.')) forgetSniperWallet();
              }} className="text-rose-300 hover:text-rose-200 disabled:opacity-40" title={balance ? 'Withdraw first' : undefined}>Remove the sniper wallet from this browser</button>
            </div>
          </details>
        </>
      )}
      <p className="text-[11px] leading-relaxed text-zinc-500">
        The sniper trades only while this page is open and the wallet is unlocked. Only what you deposit can be spent. Withdrawals always go to your connected Phantom. {usable > 0n && balance != null ? `Spendable now: ${amountToInput(usable, SOL)} SOL.` : ''}
      </p>
    </Card>
  );
}
