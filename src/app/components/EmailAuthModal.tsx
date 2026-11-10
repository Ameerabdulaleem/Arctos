import { useState, type FormEvent } from 'react';
import { Lock, Mail } from 'lucide-react';
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

  const input = 'w-full pl-10 pr-3 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</DialogTitle>
          <p className="text-center text-sm text-zinc-400">
            Your account lives on this device only. Your password is salted and hashed in your browser and is never sent anywhere.
          </p>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 py-2">
          <div>
            <label htmlFor="auth-email" className="block text-sm font-medium mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" aria-hidden />
              <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={input} />
            </div>
          </div>
          <div>
            <label htmlFor="auth-password" className="block text-sm font-medium mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" aria-hidden />
              <input
                id="auth-password" type="password" required minLength={mode === 'signup' ? 8 : undefined}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} className={input}
              />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium transition-colors">
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} className="text-center text-sm text-blue-400 hover:text-blue-300">
          {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
