import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle, CircleNotch, EnvelopeSimple, X } from '@phosphor-icons/react';
import { IconTile } from './ui/common';
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
      <div className="ring-gradient relative w-full max-w-md rounded-3xl bg-zinc-950/95 shadow-2xl shadow-black/70 motion-safe:animate-fade-up">
        <button onClick={close} className="btn btn-ghost btn-icon absolute right-3.5 top-3.5" aria-label="Close">
          <X className="h-4 w-4" weight="bold" />
        </button>
        <div className="p-8">
          {!result ? (
            <>
              <div className="text-center mb-6">
                <IconTile tone="ice" size="lg" className="mb-4 h-14 w-14 text-[28px]"><EnvelopeSimple /></IconTile>
                <h2 id="waitlist-title" className="text-2xl font-semibold text-white mb-2">Join the waitlist</h2>
                <p className="text-zinc-400 text-sm">Get an email when early access opens. No spam, and you can ask us to delete your address at any time.</p>
              </div>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="wl-email" className="block text-sm font-medium mb-2 text-zinc-300">Email address</label>
                  <input
                    id="wl-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? 'wl-error' : undefined}
                    className="field h-12 rounded-2xl px-4"
                  />
                  {error && <p id="wl-error" role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
                </div>
                <button type="submit" disabled={busy} className="btn btn-primary btn-lg w-full">
                  {busy ? (<><CircleNotch className="w-5 h-5 animate-spin" aria-hidden /> Joining...</>) : 'Join waitlist'}
                </button>
              </form>
              {count !== null && count > 0 && <p className="mt-5 text-center text-sm text-zinc-500">{count.toLocaleString()} {count === 1 ? 'person is' : 'people are'} on the list</p>}
            </>
          ) : (
            <div className="text-center py-2">
              <IconTile tone="mint" size="lg" className="mb-5 h-16 w-16 text-[34px]"><CheckCircle /></IconTile>
              <h2 id="waitlist-title" className="text-2xl font-semibold text-white mb-2">{result.alreadyJoined ? 'You are already on the list' : 'You are on the list'}</h2>
              <p className="text-zinc-400 text-sm mb-5">
                {result.alreadyJoined ? 'We already have this address.' : 'We will email you when early access opens.'}
              </p>
              {result.position !== null && (
                <div className="panel-inset mb-5 p-5">
                  <p className="text-sm text-zinc-400 mb-1">Your position</p>
                  <p className="num text-gradient text-4xl font-semibold">#{result.position.toLocaleString()}</p>
                </div>
              )}
              <button onClick={close} className="btn btn-secondary btn-lg w-full">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
