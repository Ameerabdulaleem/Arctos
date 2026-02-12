import { useState } from 'react';
import { brevoService } from '../services/brevoService';
import { X, Mail, CheckCircle, Loader2 } from 'lucide-react';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
}

export function WaitlistModal({ isOpen, onClose, theme }: WaitlistModalProps) {
  const isDark = theme === 'dark';
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const validateEmail = (email: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);

    try {
      const base = import.meta.env.VITE_API_BASE || '';
      const resp = await fetch(base + '/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const data = await resp.json()
      if (!resp.ok) throw data

      // Persist locally for UI and compute position
      const waitlist = JSON.parse(localStorage.getItem('arctos-waitlist') || '[]');
      waitlist.push({
        email,
        timestamp: new Date().toISOString(),
          position: waitlist.length + 1
      });
      localStorage.setItem('arctos-waitlist', JSON.stringify(waitlist));

        // Attempt to send a welcome email via Resend (client-side and server proxy).
        try {
          const position = waitlist.length
          const emailRes = await resendService.sendWelcomeEmail({ email, position })
          if (!emailRes.success) {
            console.error('Welcome email failed:', emailRes.message)
          }
        } catch (e) {
          console.error('Resend error', e)
        }

      setIsSubmitted(true);
    } catch (err) {
      console.error('Waitlist submit error', err)
      setError((err as any)?.error?.title || (err as any)?.message || 'Failed to join waitlist')
    } finally {
      setIsSubmitting(false)
    }
  };

  const handleClose = () => {
    setEmail('');
    setError('');
    setIsSubmitted(false);
    setIsSubmitting(false);
    onClose();
  };

  const waitlistPosition = JSON.parse(localStorage.getItem('arctos-waitlist') || '[]').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div 
        className={`relative w-full max-w-md rounded-2xl shadow-2xl ${
          isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-gray-200'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          className={`absolute top-4 right-4 p-2 rounded-lg transition-colors ${
            isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-gray-100 text-gray-600'
          }`}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="p-8">
          {!isSubmitted ? (
            <>
              {/* Header */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 mb-4">
                  <Mail className="w-8 h-8 text-white" />
                </div>
                <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Join the Waitlist
                </h2>
                <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                  Arctos is launching soon! Be among the first to access our revolutionary crypto trading platform.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="email" className={`block text-sm font-medium mb-2 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={`w-full px-4 py-3 rounded-lg border ${
                      isDark 
                        ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors`}
                    disabled={isSubmitting}
                  />
                  {error && (
                    <p className="mt-2 text-sm text-red-500">{error}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    'Join Waitlist'
                  )}
                </button>
              </form>

              {/* Additional Info */}
              <div className={`mt-6 pt-6 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'}`}>
                <p className={`text-sm text-center ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                  {waitlistPosition > 0 
                    ? `${waitlistPosition.toLocaleString()} people have already joined`
                    : 'Be the first to join!'
                  }
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Success State */}
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
                  <CheckCircle className="w-12 h-12 text-green-500" />
                </div>
                <h2 className={`text-2xl font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  You're on the list! 🎉
                </h2>
                <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                  We'll notify you at <span className="font-medium text-blue-500">{email}</span> when Arctos goes live.
                </p>

                {/* Waitlist Position */}
                <div className={`p-6 rounded-xl mb-6 ${isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-gray-50 border border-gray-200'}`}>
                  <div className={`text-sm mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                    Your Position
                  </div>
                  <div className={`text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent`}>
                    #{waitlistPosition}
                  </div>
                </div>

                {/* Social Sharing */}
                <div className={`p-4 rounded-lg ${isDark ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-blue-50 border border-blue-200'}`}>
                  <p className={`text-sm mb-3 ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                    💡 Move up the waitlist by sharing with friends
                  </p>
                </div>

                <button
                  onClick={handleClose}
                  className={`mt-6 w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                    isDark 
                      ? 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700' 
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200 border border-gray-300'
                  }`}
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
