import { useEffect, useState } from 'react';
import { ArrowSquareOut, Wallet } from '@phosphor-icons/react';
import { IconTile } from './ui/common';
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
      <DialogContent className="text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-center">Connect your wallet</DialogTitle>
          <p className="text-center text-sm text-zinc-400">
            Arctos only reads your public address to show balances. It never asks you to sign or send anything.
          </p>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {WALLET_OPTIONS.map((w) => {
            const isInstalled = installed?.[w.id];
            return (
              <div key={w.id} className="panel-inset panel-hover flex items-center gap-3 p-3">
                <IconTile tone="ice"><Wallet /></IconTile>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{w.name}</p>
                  <p className="text-xs text-zinc-500">{w.description}</p>
                </div>
                {installed && !isInstalled ? (
                  <a href={w.installUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                    Install <ArrowSquareOut className="w-3 h-3" aria-hidden />
                  </a>
                ) : (
                  <button
                    onClick={() => choose(w.id)}
                    disabled={connecting !== null || !installed}
                    className="btn btn-primary btn-sm h-9 px-4"
                  >
                    {connecting === w.id ? 'Waiting...' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <p className="text-center text-xs text-zinc-500">Only connect wallets you trust and never share your seed phrase.</p>
      </DialogContent>
    </Dialog>
  );
}
