import { useState } from 'react';
import { Lock, Wallet, Mail } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { WalletConnectionModal } from './WalletConnectionModal';
import { EmailAuthModal } from './EmailAuthModal';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  title?: string;
  description?: string;
}

export function AuthGuard({
  children,
  requireAuth = true,
  title = 'Authentication Required',
  description = 'Sign in or connect your wallet to access this feature',
}: AuthGuardProps) {
  const { isAuthenticated } = useAuth();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [emailAuthModalOpen, setEmailAuthModalOpen] = useState(false);

  if (!requireAuth || isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="h-full flex items-center justify-center bg-black p-6">
        <div className="max-w-md w-full text-center">
          {/* Lock icon */}
          <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-9 h-9 text-zinc-500" strokeWidth={1.5} />
          </div>

          <h2 className="text-2xl font-bold text-white mb-3">{title}</h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-8">{description}</p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setWalletModalOpen(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
            <button
              onClick={() => setEmailAuthModalOpen(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors font-medium text-sm border border-zinc-700"
            >
              <Mail className="w-4 h-4" />
              Sign In
            </button>
          </div>
        </div>
      </div>

      <WalletConnectionModal
        open={walletModalOpen}
        onOpenChange={setWalletModalOpen}
      />
      <EmailAuthModal
        open={emailAuthModalOpen}
        onOpenChange={setEmailAuthModalOpen}
      />
    </>
  );
}
