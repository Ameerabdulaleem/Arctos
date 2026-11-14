import { useState, type FormEvent } from 'react';
import { EnvelopeSimple, LockSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { useAuth } from '../contexts/auth-context';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmailAuthModal({ open, onOpenChange }: Props) {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signin') await signInWithEmail(email, password);
      else await signUpWithEmail(email, password);
      toast.success(mode === 'signin' ? 'Signed in' : 'Account created');
      setPassword('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const input = 'field h-12 rounded-2xl pl-10';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-center">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</DialogTitle>
          <p className="text-center text-sm text-zinc-400">
            Your account lives on this device only. Your password is salted and hashed in your browser and is never sent anywhere.
          </p>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 py-2">
          <div>
            <label htmlFor="auth-email" className="label mb-1.5 block text-sm text-zinc-300">Email</label>
            <div className="relative">
              <EnvelopeSimple className="absolute left-3.5 top-4 h-4 w-4 text-zinc-500" aria-hidden />
              <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={input} />
            </div>
          </div>
          <div>
            <label htmlFor="auth-password" className="label mb-1.5 block text-sm text-zinc-300">Password</label>
            <div className="relative">
              <LockSimple className="absolute left-3.5 top-4 h-4 w-4 text-zinc-500" aria-hidden />
              <input
                id="auth-password" type="password" required minLength={mode === 'signup' ? 8 : undefined}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} className={input}
              />
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} className="text-center text-sm text-blue-300 hover:text-blue-200">
          {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
