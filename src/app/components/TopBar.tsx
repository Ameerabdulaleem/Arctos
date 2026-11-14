import { List, SignOut, User, Wallet } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/auth-context';
import { useTickers } from '../hooks/useTickers';
import { formatPct, formatPrice, pnlClass, shortAddress } from '../lib/format';
import { LiveStatus } from './LiveStatus';

interface Props {
  title: string;
  onMenu: () => void;
  onConnectWallet: () => void;
  onSignIn: () => void;
}

const STRIP = ['BTC', 'ETH', 'SOL'];

/** A compact price strip so the market is always in view. */
function MarketStrip() {
  const { tickers } = useTickers();
  const shown = STRIP.map((base) => tickers[base]).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div className="hidden items-center gap-1 rounded-xl border border-white/[0.06] bg-black/30 px-1 py-1 xl:flex" aria-label="Live prices">
      {shown.map((t) => (
        <span key={t.base} className="flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs">
          <span className="font-semibold text-zinc-300">{t.base}</span>
          <span className="num text-white">{formatPrice(t.price)}</span>
          <span className={`num ${pnlClass(t.change24hPct)}`}>{formatPct(t.change24hPct)}</span>
        </span>
      ))}
    </div>
  );
}

export function TopBar({ title, onMenu, onConnectWallet, onSignIn }: Props) {
  const { user, isAuthenticated, isWalletConnected, disconnectWallet, signOut } = useAuth();

  return (
    <header className="glass z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-x-0 border-t-0 px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onMenu} className="btn btn-ghost btn-icon -ml-2 lg:hidden" aria-label="Open menu">
          <List className="h-5 w-5" weight="bold" />
        </button>
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden text-zinc-500 sm:inline">Workspace</span>
          <span className="hidden text-zinc-700 sm:inline" aria-hidden>/</span>
          <h2 className="truncate font-semibold text-white">{title}</h2>
        </div>
        <div className="hidden sm:block"><LiveStatus /></div>
      </div>

      <div className="flex items-center gap-2">
        <MarketStrip />
        {!isAuthenticated ? (
          <>
            <button onClick={onSignIn} className="btn btn-secondary btn-sm hidden h-9 sm:inline-flex">
              <User className="h-4 w-4" aria-hidden /> Sign in
            </button>
            <button onClick={onConnectWallet} className="btn btn-primary btn-sm h-9">
              <Wallet className="h-4 w-4" weight="fill" aria-hidden /> Connect wallet
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="hidden h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-200 sm:inline-flex">
              {isWalletConnected ? <Wallet className="h-4 w-4 text-emerald-300" aria-hidden /> : <User className="h-4 w-4 text-blue-300" aria-hidden />}
              <span className="font-mono text-xs">{isWalletConnected ? shortAddress(user?.walletAddress) : user?.email}</span>
            </span>
            <button
              onClick={() => {
                if (isWalletConnected) disconnectWallet();
                else signOut();
                toast.success(isWalletConnected ? 'Wallet disconnected' : 'Signed out');
              }}
              className="btn btn-secondary btn-sm h-9"
              aria-label={isWalletConnected ? 'Disconnect wallet' : 'Sign out'}
            >
              <SignOut className="h-4 w-4" aria-hidden />
              <span className="hidden md:inline">{isWalletConnected ? 'Disconnect' : 'Sign out'}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
