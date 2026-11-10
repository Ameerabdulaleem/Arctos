import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle, Loader2, Mail, X } from 'lucide-react';
import { EMAIL_PATTERN, waitlistService, type JoinResult } from '../services/waitlistService';
import { errorMessage } from '../services/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function WaitlistModal({ isOpen, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<JoinResult | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    void waitlistService.count(controller.signal).then(setCount);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      controller.abort();
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const close = () => {
    setEmail('');
    setError('');
    setResult(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      setResult(await waitlistService.join(email));
    } catch (err) {
      setError(errorMessage(err, 'We could not add you right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="waitlist-title">
      <div className="relative w-full max-w-md rounded-2xl shadow-2xl bg-zinc-900 border border-zinc-800">
        <button onClick={close} className="absolute top-4 right-4 p-2 rounded-lg text-zinc-400 hover:bg-zinc-800" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
        <div className="p-8">
          {!result ? (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 mb-4">
                  <Mail className="w-7 h-7 text-white" aria-hidden />
                </div>
                <h2 id="waitlist-title" className="text-2xl font-bold text-white mb-2">Join the waitlist</h2>
                <p className="text-zinc-400 text-sm">Get an email when early access opens. No spam, and you can ask us to delete your address at any time.</p>
              </div>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="wl-email" className="block text-sm font-medium mb-2 text-zinc-300">Email address</label>
                  <input
                    id="wl-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? 'wl-error' : undefined}
                    className="w-full px-4 py-3 rounded-lg border bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                  {error && <p id="wl-error" role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
                </div>
                <button type="submit" disabled={busy} className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {busy ? (<><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Joining...</>) : 'Join waitlist'}
                </button>
              </form>
              {count !== null && count > 0 && <p className="mt-5 text-center text-sm text-zinc-500">{count.toLocaleString()} {count === 1 ? 'person is' : 'people are'} on the list</p>}
            </>
          ) : (
            <div className="text-center py-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-5">
                <CheckCircle className="w-10 h-10 text-emerald-500" aria-hidden />
              </div>
              <h2 id="waitlist-title" className="text-2xl font-bold text-white mb-2">{result.alreadyJoined ? 'You are already on the list' : 'You are on the list'}</h2>
              <p className="text-zinc-400 text-sm mb-5">
                {result.alreadyJoined ? 'We already have this address.' : 'We will email you when early access opens.'}
              </p>
              {result.position !== null && (
                <div className="p-5 rounded-xl mb-5 bg-zinc-800 border border-zinc-700">
                  <p className="text-sm text-zinc-400 mb-1">Your position</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">#{result.position.toLocaleString()}</p>
                </div>
              )}
              <button onClick={close} className="w-full px-6 py-3 rounded-lg font-medium bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
