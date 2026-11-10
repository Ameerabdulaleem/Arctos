import { LogOut, Menu, User, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/auth-context';
import { LiveStatus } from './LiveStatus';
import { shortAddress } from '../lib/format';
import { toast } from 'sonner';

interface Props {
  title: string;
  onMenu: () => void;
  onConnectWallet: () => void;
  onSignIn: () => void;
}

export function TopBar({ title, onMenu, onConnectWallet, onSignIn }: Props) {
  const { user, isAuthenticated, isWalletConnected, disconnectWallet, signOut } = useAuth();

  return (
    <header className="h-14 shrink-0 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur flex items-center justify-between gap-3 px-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onMenu} className="lg:hidden p-2 -ml-2 text-zinc-300 hover:text-white" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
        <div className="hidden sm:block"><LiveStatus /></div>
      </div>

      <div className="flex items-center gap-2">
        {!isAuthenticated ? (
          <>
            <button onClick={onSignIn} className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors">
              <User className="w-4 h-4" aria-hidden /> Sign in
            </button>
            <button onClick={onConnectWallet} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              <Wallet className="w-4 h-4" aria-hidden /> Connect wallet
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-sm text-zinc-200">
              {isWalletConnected ? <Wallet className="w-4 h-4 text-emerald-400" aria-hidden /> : <User className="w-4 h-4 text-blue-400" aria-hidden />}
              <span className="font-mono text-xs">{isWalletConnected ? shortAddress(user?.walletAddress) : user?.email}</span>
            </span>
            <button
              onClick={() => {
                if (isWalletConnected) disconnectWallet();
                else signOut();
                toast.success(isWalletConnected ? 'Wallet disconnected' : 'Signed out');
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-sm transition-colors"
              aria-label={isWalletConnected ? 'Disconnect wallet' : 'Sign out'}
            >
              <LogOut className="w-4 h-4" aria-hidden />
              <span className="hidden md:inline">{isWalletConnected ? 'Disconnect' : 'Sign out'}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
