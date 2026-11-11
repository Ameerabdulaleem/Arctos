import { useEffect, useState } from 'react';
import { ExternalLink, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useAuth } from '../contexts/auth-context';
import { installedWallets, WALLET_OPTIONS, WalletError, type WalletType } from '../services/walletService';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletConnectionModal({ open, onOpenChange }: Props) {
  const { connectWallet } = useAuth();
  const [installed, setInstalled] = useState<Record<WalletType, boolean> | null>(null);
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void installedWallets().then((r) => !cancelled && setInstalled(r));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const choose = async (id: WalletType) => {
    setConnecting(id);
    setError(null);
    try {
      await connectWallet(id);
      toast.success('Wallet connected');
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof WalletError || e instanceof Error ? e.message : 'The wallet could not connect.');
    } finally {
      setConnecting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">Connect your wallet</DialogTitle>
          <p className="text-center text-sm text-zinc-400">
            Arctos only reads your public address to show balances. It never asks you to sign or send anything.
          </p>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {WALLET_OPTIONS.map((w) => {
            const isInstalled = installed?.[w.id];
            return (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3 hover:border-zinc-700 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5 text-zinc-300" aria-hidden /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{w.name}</p>
                  <p className="text-xs text-zinc-500">{w.description}</p>
                </div>
                {installed && !isInstalled ? (
                  <a href={w.installUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                    Install <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                ) : (
                  <button
                    onClick={() => choose(w.id)}
                    disabled={connecting !== null || !installed}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {connecting === w.id ? 'Waiting...' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <p className="text-center text-xs text-zinc-500">Only connect wallets you trust and never share your seed phrase.</p>
      </DialogContent>
    </Dialog>
  );
}
