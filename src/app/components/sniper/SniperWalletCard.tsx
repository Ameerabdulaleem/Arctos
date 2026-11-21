import { useEffect, useState } from 'react';
import { ArrowDown, ArrowSquareOut, ArrowUp, Eye, Key, Lock, LockOpen, Vault, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { amountToInput, cleanAmountInput, formatAmount, parseAmount } from '../../swap/amount';
import { chainByKey, type SwapChain } from '../../swap/chains';
import {
  createEvmSniperWallet, depositToEvmSniper, evmReserve, evmSniperBalance, evmSniperInfo, exportEvmSniperSecret, forgetEvmSniper,
  lockEvmSniper, markEvmBackedUp, SNIPER_EVM_CHAINS, unlockEvmSniper, withdrawFromEvmSniper, type EvmSniperInfo,
} from '../../swap/sniperEvm';
import { signSolanaTransaction } from '../../swap/solanaSign';
import {
  createSniperWallet, depositToSniper, exportSniperSecret, forgetSniperWallet, lockSniperWallet, markBackedUp, MIN_PASSWORD,
  onSniperWalletChange, sniperBalance, sniperWalletInfo, SOL_RESERVE, unlockSniperWallet, withdrawFromSniper, type SniperWalletInfo,
} from '../../swap/sniperWallet';
import type { EvmWallet, SolanaWallet } from '../../swap/wallets';
import { WALLET_OPTIONS, type WalletType } from '../../services/walletService';
import { shortAddress } from '../../lib/format';
import { Card, IconTile } from '../ui/common';
import { CopyAddress } from '../ui/CopyAddress';

const SOL = 9;
/** EVM chains whose balance is read without being picked, where sniping is most common. */
const WATCHED = ['bsc', 'base', 'ethereum', 'arbitrum'];

function useSniperWallets(): { sol: SniperWalletInfo | null; evm: EvmSniperInfo | null } {
  const [state, setState] = useState(() => ({ sol: sniperWalletInfo(), evm: evmSniperInfo() }));
  useEffect(() => onSniperWalletChange(() => setState({ sol: sniperWalletInfo(), evm: evmSniperInfo() })), []);
  return state;
}

/** A secret key, shown once after creation or on export, with a copy button. */
function SecretBox({ label, secret, importHint, onDone, done }: { label: string; secret: string; importHint: string; onDone: () => void; done: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3 text-xs text-amber-100">
      <p className="flex items-start gap-1.5 font-semibold"><Warning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Save the {label} somewhere safe and private.</p>
      <p>It is the only way to recover this wallet if this browser's data is cleared. {importHint} Anyone who has it can take the funds, so never share it or paste it into a website.</p>
      <div className="flex items-center gap-2 rounded-lg bg-black/40 p-2">
        <code className="num min-w-0 flex-1 break-all text-[11px] text-zinc-100">{shown ? secret : '•'.repeat(44)}</code>
        <button type="button" onClick={() => setShown((s) => !s)} className="btn btn-ghost btn-icon h-8 w-8" aria-label={shown ? 'Hide the key' : 'Show the key'}><Eye className="h-4 w-4" /></button>
        <CopyAddress value={secret} label={`Copy the ${label}`} size="sm" />
      </div>
      <button type="button" onClick={onDone} className="btn btn-primary btn-sm">{done}</button>
    </div>
  );
}

const SOL_HINT = 'You can import it into Phantom (Add account, Import private key).';
const EVM_HINT = 'You can import it into MetaMask, Rabby or OKX (Import account, private key).';

export function SniperWalletCard({ phantom, onConnectPhantom, evmWallet, onConnectEvm, focusChain, solPriceUsd, onBalance, onEvmBalances }: {
  phantom: SolanaWallet | null;
  onConnectPhantom: () => void;
  evmWallet: EvmWallet | null;
  onConnectEvm: (type: WalletType) => void;
  /** The chain picked in the sniper, so the matching wallet shows first. */
  focusChain: string;
  solPriceUsd: number | null;
  /** Reports the balances, so the auto sniper knows the budget on each chain. */
  onBalance: (lamports: bigint | null) => void;
  onEvmBalances: (balances: Record<string, bigint | null>) => void;
}) {
  const { sol, evm } = useSniperWallets();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [secrets, setSecrets] = useState<Array<{ kind: 'sol' | 'evm'; value: string; fresh: boolean }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const focusEvm = chainByKey(focusChain)?.vm === 'evm';
  const [side, setSide] = useState<'sol' | 'evm'>(focusEvm ? 'evm' : 'sol');
  useEffect(() => { setSide(focusEvm ? 'evm' : 'sol'); }, [focusEvm]);
  const [evmChainKey, setEvmChainKey] = useState(focusEvm ? focusChain : 'bsc');
  useEffect(() => { if (focusEvm) setEvmChainKey(focusChain); }, [focusEvm, focusChain]);

  // Balances are read here, not in the tabs, so the auto sniper knows every chain's budget
  // whichever tab is open.
  const [solBalance, setSolBalance] = useState<bigint | null>(null);
  const [evmBalances, setEvmBalances] = useState<Record<string, bigint | null>>({});
  const solAddress = sol?.address;
  useEffect(() => {
    if (!solAddress) return;
    let live = true;
    const load = () => sniperBalance().then((b) => { if (live) { setSolBalance(b); onBalance(b); } }).catch(() => {});
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [solAddress, tick, onBalance]);
  const evmAddress = evm?.address;
  useEffect(() => {
    if (!evmAddress) return;
    let live = true;
    const keys = [...new Set([...WATCHED, evmChainKey])];
    const load = async () => {
      const read = await Promise.all(keys.map(async (k) => [k, await evmSniperBalance(SNIPER_EVM_CHAINS.find((c) => c.key === k) as SwapChain).catch(() => null)] as const));
      if (!live) return;
      const next = Object.fromEntries(read);
      setEvmBalances((prev) => ({ ...prev, ...next }));
      onEvmBalances(next);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [evmAddress, evmChainKey, tick, onEvmBalances]);

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

  const showSecret = (kind: 'sol' | 'evm', value: string, fresh: boolean) => setSecrets((list) => [...list.filter((s) => s.kind !== kind), { kind, value, fresh }]);
  const secretBoxes = secrets.map((s) => (
    <SecretBox key={s.kind} label={s.kind === 'sol' ? 'Solana secret key' : 'EVM private key'} secret={s.value} importHint={s.kind === 'sol' ? SOL_HINT : EVM_HINT}
      done={s.fresh ? 'I saved the key' : 'Hide the key'}
      onDone={() => { if (s.fresh) (s.kind === 'sol' ? markBackedUp : markEvmBackedUp)(); setSecrets((list) => list.filter((x) => x.kind !== s.kind)); }} />
  ));

  if (!sol && !evm) {
    const valid = password.length >= MIN_PASSWORD && password === confirm;
    return (
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="violet" size="sm"><Vault /></IconTile>Create your sniper wallets</h2>
        <p className="text-xs leading-relaxed text-zinc-400">
          Two wallets for the sniper, kept only in this browser and protected by one password: a <b className="text-zinc-200">Solana</b> wallet, and an <b className="text-zinc-200">EVM</b> wallet that works on BNB Chain, Base, Ethereum, Arbitrum and the other EVM chains. You move a budget into them from your own wallets, the sniper buys and sells on any chain you funded without a popup for each trade, and you withdraw back whenever you like. Your main wallets are never touched, and the keys never leave your device.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`Password, at least ${MIN_PASSWORD} characters`} className="field py-2" aria-label="Sniper wallet password" />
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat the password" className="field py-2" aria-label="Repeat the password" />
        </div>
        <p className="text-[11px] text-zinc-500">Arctos cannot recover this password. You will see each wallet's key once, to save as a backup.</p>
        <button type="button" disabled={!valid || busy !== null} onClick={() => void run('create', async () => {
          const s = await createSniperWallet(password);
          const e = await createEvmSniperWallet(password);
          setPassword('');
          setConfirm('');
          setSecrets([{ kind: 'sol', value: s.secret, fresh: true }, { kind: 'evm', value: e.secret, fresh: true }]);
        })} className="btn btn-primary">{busy === 'create' ? 'Creating…' : 'Create sniper wallets'}</button>
      </Card>
    );
  }

  const anyUnlocked = Boolean(sol?.unlocked || evm?.unlocked);
  const allUnlocked = (!sol || sol.unlocked) && (!evm || evm.unlocked);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 font-semibold text-white"><IconTile tone="violet" size="sm"><Vault /></IconTile>Sniper wallets</h2>
        <div className="seg flex" role="tablist" aria-label="Sniper wallet">
          <button type="button" role="tab" aria-selected={side === 'sol'} onClick={() => setSide('sol')} className="seg-item px-3 py-1 text-xs">Solana</button>
          <button type="button" role="tab" aria-selected={side === 'evm'} onClick={() => setSide('evm')} className="seg-item px-3 py-1 text-xs">EVM (BNB Chain and more)</button>
        </div>
      </div>

      {secretBoxes}

      {!allUnlocked && (
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          void run('unlock', async () => {
            const results = await Promise.allSettled([sol && !sol.unlocked ? unlockSniperWallet(password) : null, evm && !evm.unlocked ? unlockEvmSniper(password) : null]);
            if (results.every((r) => r.status === 'rejected' || r.value === null) && results.some((r) => r.status === 'rejected')) throw new Error('Wrong password.');
            setPassword('');
          });
        }}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password to unlock" className="field flex-1 py-2" aria-label="Sniper wallet password" />
          <button type="submit" disabled={!password || busy !== null} className="btn btn-primary"><LockOpen className="h-4 w-4" aria-hidden />{busy === 'unlock' ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      )}

      {side === 'sol' ? (
        sol ? <SolanaSide info={sol} balance={solBalance} phantom={phantom} onConnectPhantom={onConnectPhantom} solPriceUsd={solPriceUsd} busy={busy} run={run} onSecret={(v, fresh) => showSecret('sol', v, fresh)} />
          : <AddWallet kind="Solana" busy={busy} onAdd={(pw) => run('add', async () => {
            await exportEvmSniperSecret(pw); // the same password as the EVM wallet
            const s = await createSniperWallet(pw);
            showSecret('sol', s.secret, true);
          })} />
      ) : (
        evm ? <EvmSide info={evm} balances={evmBalances} chainKey={evmChainKey} onChain={setEvmChainKey} wallet={evmWallet} onConnect={onConnectEvm} busy={busy} run={run} onSecret={(v, fresh) => showSecret('evm', v, fresh)} />
          : <AddWallet kind="EVM" busy={busy} onAdd={(pw) => run('add', async () => {
            const e = await createEvmSniperWallet(pw);
            showSecret('evm', e.secret, true);
          })} />
      )}

      {anyUnlocked && (
        <button type="button" onClick={() => { lockSniperWallet(); lockEvmSniper(); }} className="btn btn-ghost btn-sm"><Lock className="h-4 w-4" aria-hidden />Lock both wallets</button>
      )}
      <p className="text-[11px] leading-relaxed text-zinc-500">The sniper trades only while this page is open and the wallets are unlocked. Only what you deposit can be spent. Withdrawals always go to your own connected wallet.</p>
    </Card>
  );
}

function AddWallet({ kind, busy, onAdd }: { kind: 'Solana' | 'EVM'; busy: string | null; onAdd: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void onAdd(pw).then(() => setPw('')); }}>
      <p className="text-xs text-zinc-400">
        {kind === 'EVM'
          ? 'Add the EVM sniper wallet to snipe on BNB Chain, Base, Ethereum and the other EVM chains. It uses the same password as your Solana sniper wallet.'
          : 'Add the Solana sniper wallet. It uses the same password as your EVM sniper wallet.'}
      </p>
      <div className="flex gap-2">
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your sniper wallet password" className="field flex-1 py-2" aria-label="Sniper wallet password" />
        <button type="submit" disabled={pw.length < MIN_PASSWORD || busy !== null} className="btn btn-primary">{busy === 'add' ? 'Creating…' : `Add ${kind} wallet`}</button>
      </div>
    </form>
  );
}

type Run = (label: string, job: () => Promise<void>) => Promise<void>;

function KeyOptions({ busy, run, onExport, onForget, canForget }: { busy: string | null; run: Run; onExport: (password: string) => Promise<void>; onForget: () => void; canForget: boolean }) {
  const [pw, setPw] = useState('');
  return (
    <details className="text-xs text-zinc-400">
      <summary className="cursor-pointer select-none text-zinc-300">Key and wallet options</summary>
      <div className="mt-2 space-y-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run('export', async () => { await onExport(pw); setPw(''); }); }}>
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="field flex-1 py-1.5" aria-label="Password to export the key" />
          <button type="submit" disabled={!pw || busy !== null} className="btn btn-secondary btn-sm"><Key className="h-4 w-4" aria-hidden />Export key</button>
        </form>
        <button type="button" disabled={busy !== null || !canForget} onClick={() => {
          if (window.confirm('Remove this sniper wallet from this browser? Only do this after withdrawing its funds or saving its key.')) onForget();
        }} className="text-rose-300 hover:text-rose-200 disabled:opacity-40" title={canForget ? undefined : 'Withdraw first'}>Remove this wallet from this browser</button>
      </div>
    </details>
  );
}

function SolanaSide({ info, balance, phantom, onConnectPhantom, solPriceUsd, busy, run, onSecret }: {
  info: SniperWalletInfo; balance: bigint | null; phantom: SolanaWallet | null; onConnectPhantom: () => void; solPriceUsd: number | null;
  busy: string | null; run: Run; onSecret: (value: string, fresh: boolean) => void;
}) {
  const [deposit, setDeposit] = useState('0.2');

  const usable = balance != null && balance > SOL_RESERVE ? balance - SOL_RESERVE : 0n;
  const usd = (lamports: bigint) => (solPriceUsd ? ` (about $${((Number(lamports) / 1e9) * solPriceUsd).toFixed(2)})` : '');
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1 text-xs text-zinc-400">
        Solana <span className="num">{shortAddress(info.address, 5, 5)}</span><CopyAddress value={info.address} label="Copy the Solana sniper wallet address" />
        <a href={`https://solscan.io/account/${info.address}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label="Open the Solana sniper wallet on Solscan"><ArrowSquareOut className="h-3.5 w-3.5" /></a>
      </p>
      <div className="panel-inset p-3">
        <p className="eyebrow text-[10px]">Budget on Solana</p>
        <p className="num text-xl font-semibold text-white">{balance == null ? '…' : `${formatAmount(balance, SOL, 4)} SOL`}</p>
        <p className="text-[11px] text-zinc-500">{balance == null ? 'Reading the balance' : `${formatAmount(usable, SOL, 4)} SOL can be spent${usd(usable)}. ${formatAmount(SOL_RESERVE, SOL, 2)} SOL stays for network fees and token accounts.`}</p>
      </div>
      {info.unlocked && (
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
          <button type="button" disabled={busy !== null || !phantom || !balance} onClick={() => void run('withdraw', async () => {
            if (!phantom) return;
            const sig = await withdrawFromSniper(phantom.address);
            toast.success('Withdrawn to Phantom', { description: `Transaction ${shortAddress(sig, 6, 6)}` });
          })} className="btn btn-secondary btn-sm" title={phantom ? `Sends all SOL to ${shortAddress(phantom.address)}` : 'Connect Phantom first'}>
            <ArrowUp className="h-4 w-4" aria-hidden />{busy === 'withdraw' ? 'Sending…' : 'Withdraw all SOL to Phantom'}
          </button>
          {!info.backedUp && <p className="text-[11px] text-amber-200">You have not confirmed saving this wallet's secret key yet. Export it below and keep it safe.</p>}
          <KeyOptions busy={busy} run={run} canForget={!balance} onForget={forgetSniperWallet} onExport={async (pw) => onSecret(await exportSniperSecret(pw), !info.backedUp)} />
          {usable > 0n && <p className="text-[11px] text-zinc-500">Spendable now: {amountToInput(usable, SOL)} SOL.</p>}
        </>
      )}
    </div>
  );
}

function EvmSide({ info, balances, chainKey, onChain, wallet, onConnect, busy, run, onSecret }: {
  info: EvmSniperInfo; balances: Record<string, bigint | null>; chainKey: string; onChain: (key: string) => void;
  wallet: EvmWallet | null; onConnect: (type: WalletType) => void; busy: string | null; run: Run; onSecret: (value: string, fresh: boolean) => void;
}) {
  const chain = SNIPER_EVM_CHAINS.find((c) => c.key === chainKey) ?? SNIPER_EVM_CHAINS[0];
  const [deposit, setDeposit] = useState('0.05');
  const dec = chain.native.decimals;

  const balance = balances[chain.key] ?? null;
  const reserve = evmReserve(chain);
  const usable = balance != null && balance > reserve ? balance - reserve : 0n;
  const funded = SNIPER_EVM_CHAINS.filter((c) => c.key !== chain.key && (balances[c.key] ?? 0n) > 0n);
  const sameWallet = wallet?.address.toLowerCase() === info.address.toLowerCase();

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-1 text-xs text-zinc-400">
        EVM <span className="num">{shortAddress(info.address, 5, 5)}</span><CopyAddress value={info.address} label="Copy the EVM sniper wallet address" />
        <a href={`${chain.explorer}/address/${info.address}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white" aria-label={`Open the EVM sniper wallet on ${chain.name}'s explorer`}><ArrowSquareOut className="h-3.5 w-3.5" /></a>
        <span className="text-zinc-500">The same address on every EVM chain.</span>
      </p>
      <label className="flex items-center gap-2 text-xs text-zinc-400">Chain
        <select value={chain.key} onChange={(e) => onChain(e.target.value)} className="field py-1.5 text-xs">
          {SNIPER_EVM_CHAINS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
      </label>
      <div className="panel-inset p-3">
        <p className="eyebrow text-[10px]">Budget on {chain.name}</p>
        <p className="num text-xl font-semibold text-white">{balance == null ? '…' : `${formatAmount(balance, dec, 5)} ${chain.native.symbol}`}</p>
        <p className="text-[11px] text-zinc-500">{balance == null ? 'Reading the balance' : `${formatAmount(usable, dec, 5)} ${chain.native.symbol} can be spent. ${formatAmount(reserve, dec, 4)} ${chain.native.symbol} stays for network fees and approvals.`}</p>
        {funded.length > 0 && <p className="mt-1 text-[11px] text-zinc-400">Also funded: {funded.map((c) => `${formatAmount(balances[c.key] ?? 0n, c.native.decimals, 4)} ${c.native.symbol} on ${c.name}`).join(', ')}.</p>}
      </div>
      {info.unlocked && (
        <>
          <div className="space-y-1.5">
            <p className="eyebrow">Deposit {chain.native.symbol} on {chain.name} from your wallet</p>
            {wallet && !sameWallet ? (
              <div className="flex gap-2">
                <span className="relative flex-1">
                  <input value={deposit} inputMode="decimal" onChange={(e) => setDeposit(cleanAmountInput(e.target.value, dec))} className="field num py-2 pr-14" aria-label={`${chain.native.symbol} to deposit`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">{chain.native.symbol}</span>
                </span>
                <button type="button" disabled={busy !== null || !parseAmount(deposit, dec)} onClick={() => void run('deposit', async () => {
                  const amount = parseAmount(deposit, dec);
                  if (!amount) return;
                  await depositToEvmSniper(chain, wallet, amount);
                  toast.success(`Deposited ${deposit} ${chain.native.symbol} on ${chain.name}`);
                })} className="btn btn-secondary"><ArrowDown className="h-4 w-4" aria-hidden />{busy === 'deposit' ? 'Waiting…' : 'Deposit'}</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-400">{sameWallet ? 'Connect your own EVM wallet, not the sniper wallet:' : 'Connect an EVM wallet to deposit:'}</span>
                {WALLET_OPTIONS.map((w) => <button key={w.id} type="button" onClick={() => onConnect(w.id)} className="btn btn-secondary btn-sm">{w.name}</button>)}
              </div>
            )}
            <p className="text-[11px] text-zinc-500">Or send {chain.native.symbol} on {chain.name} to the address above from any wallet or exchange.</p>
          </div>
          <button type="button" disabled={busy !== null || !wallet || !balance || sameWallet} onClick={() => void run('withdraw', async () => {
            if (!wallet) return;
            await withdrawFromEvmSniper(chain, wallet.address);
            toast.success(`Withdrawn to ${shortAddress(wallet.address)}`);
          })} className="btn btn-secondary btn-sm" title={wallet ? `Sends all ${chain.native.symbol} on ${chain.name} to ${shortAddress(wallet.address)}` : 'Connect an EVM wallet first'}>
            <ArrowUp className="h-4 w-4" aria-hidden />{busy === 'withdraw' ? 'Sending…' : `Withdraw all ${chain.native.symbol} to your wallet`}
          </button>
          {!info.backedUp && <p className="text-[11px] text-amber-200">You have not confirmed saving this wallet's private key yet. Export it below and keep it safe.</p>}
          <KeyOptions busy={busy} run={run} canForget={Object.values(balances).every((b) => !b)} onForget={forgetEvmSniper} onExport={async (pw) => onSecret(await exportEvmSniperSecret(pw), !info.backedUp)} />
        </>
      )}
    </div>
  );
}
