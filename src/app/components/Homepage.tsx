import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BarChart3, Brain, CheckCircle, Eye, Github, Loader2, Newspaper, Send, Target, Twitter } from 'lucide-react';
import { toast } from 'sonner';
import arctosLogo from '../../assets/images/arctos-logo.png.png';
import { LegalDialog, type LegalTopic } from './LegalDialog';
import { LiveStatus } from './LiveStatus';
import { useTickers } from '../hooks/useTickers';
import { usePolling } from '../hooks/usePolling';
import { marketService } from '../services/marketService';
import { statusService } from '../services/statusService';
import { EMAIL_PATTERN, waitlistService, type JoinResult } from '../services/waitlistService';
import { errorMessage } from '../services/api';
import { formatCompactUsd, formatPct, formatPrice, pnlClass, safeHref, sparklinePath } from '../lib/format';

interface Props {
  onLaunch: () => void;
  onOpenWaitlist: () => void;
  onOpenWallet: () => void;
}

const REPO_URL = 'https://github.com/ameerabdulaleem/arctos';
const SOCIAL = {
  x: safeHref(import.meta.env.VITE_SOCIAL_X) ?? 'https://twitter.com/arctosapp',
  telegram: safeHref(import.meta.env.VITE_SOCIAL_TELEGRAM) ?? 'https://t.me/arctos',
  github: safeHref(import.meta.env.VITE_SOCIAL_GITHUB) ?? REPO_URL,
};

const HEADLINE = 'Arctos brings live market data, whale tracking, fundamental news and an AI assistant into one trading workspace.';

const FEATURES = [
  { icon: BarChart3, title: 'Live trading terminal', text: 'Real candles, order book and trades streamed from the exchange, with paper trading so you can practise without risking funds.', gradient: 'from-orange-500 to-red-500' },
  { icon: Brain, title: 'AI that sees the market', text: 'Ask questions answered from live prices, headlines, whale moves and your own portfolio, not from stale training data.', gradient: 'from-blue-500 to-cyan-500' },
  { icon: Target, title: 'Sniper engine', text: 'Watch brand new liquidity pools on five chains and see contract risk checks for honeypots, taxes and mint rights before you act.', gradient: 'from-purple-500 to-pink-500' },
  { icon: Eye, title: 'Whale alerts', text: 'Large on chain transfers on Ethereum, BNB Chain, Base, Arbitrum and Bitcoin, with labels for known exchange wallets.', gradient: 'from-green-500 to-emerald-500' },
  { icon: Newspaper, title: 'Fundamental news', text: 'Headlines from major crypto outlets, scored by likely market impact and refreshed every two minutes.', gradient: 'from-yellow-500 to-amber-500' },
  { icon: CheckCircle, title: 'Honest by design', text: 'Every number on screen comes from a live source. When a source is down we tell you instead of showing made up data.', gradient: 'from-indigo-500 to-blue-500' },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const c = new AbortController();
    void waitlistService.count(c.signal).then(setCount);
    return () => c.abort();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      setResult(await waitlistService.join(email));
      setEmail('');
    } catch (err) {
      toast.error(errorMessage(err, 'We could not add you right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div role="status" className="flex items-center gap-2 text-emerald-400">
        <CheckCircle className="w-5 h-5 shrink-0" aria-hidden />
        <span className="font-medium">
          {result.alreadyJoined ? 'You are already on the list.' : 'You are on the list.'}
          {result.position !== null && ` You are number ${result.position.toLocaleString()}.`}
        </span>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={submit} className={`flex flex-col sm:flex-row gap-3 ${compact ? 'max-w-lg mx-auto' : 'max-w-md'}`} noValidate>
        <label htmlFor={`wl-${compact ? 'b' : 'a'}`} className="sr-only">Email for early access</label>
        <input
          id={`wl-${compact ? 'b' : 'a'}`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email for early access" disabled={busy}
          className="flex-1 px-4 py-3 rounded-lg border bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />
        <button type="submit" disabled={busy} className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Joining...' : 'Join waitlist'}
        </button>
      </form>
      {count !== null && count > 0 && <p className="mt-2 text-xs text-zinc-500">{count.toLocaleString()} {count === 1 ? 'person is' : 'people are'} on the list.</p>}
    </div>
  );
}

export function Homepage({ onLaunch, onOpenWaitlist, onOpenWallet }: Props) {
  const { tickers } = useTickers();
  const overview = usePolling((s) => marketService.overview(s), 60_000);
  const coins = usePolling((s) => marketService.coins(100, s), 60_000);
  const status = usePolling((s) => statusService.get(s), 60_000);
  const [legal, setLegal] = useState<LegalTopic | null>(null);

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [typed, setTyped] = useState(reducedMotion ? HEADLINE.length : 0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setTyped((n) => (n >= HEADLINE.length ? n : n + 1)), 28);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const btc = tickers.BTC;
  const g = overview.data?.global;
  const fng = overview.data?.fearGreed;
  const btcCoin = coins.data?.coins.find((c) => c.id === 'bitcoin');
  const movers = [...(coins.data?.coins ?? [])].filter((c) => c.change24h != null).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 4);
  const stats = [
    { label: 'Total market cap', value: g ? formatCompactUsd(g.totalMarketCapUsd) : null },
    { label: '24h volume', value: g ? formatCompactUsd(g.totalVolume24hUsd) : null },
    { label: 'Bitcoin dominance', value: g ? `${g.btcDominance.toFixed(1)}%` : null },
    { label: 'Fear and Greed', value: fng ? `${fng.value} ${fng.label}` : null },
  ];
  const strip = ['BTC', 'ETH', 'SOL', 'BNB'].map((s) => tickers[s]).filter(Boolean);
  const nav = 'text-sm text-zinc-400 hover:text-white transition-colors';

  return (
    <div className="min-h-screen bg-black text-zinc-100 relative overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <nav className="fixed top-0 inset-x-0 z-40 bg-black/70 border-b border-zinc-800 backdrop-blur-md" aria-label="Primary">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={arctosLogo} alt="" className="w-9 h-9 object-contain" />
            <span className="text-lg font-semibold tracking-tight">Arctos</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <button className={nav} onClick={() => scrollTo('features')}>Features</button>
            <button className={nav} onClick={() => scrollTo('about')}>About</button>
            <button className={nav} onClick={() => scrollTo('contact')}>Contact</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenWaitlist} className="hidden sm:inline-flex px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-900 text-sm">Join waitlist</button>
            <button onClick={onOpenWallet} className="hidden lg:inline-flex px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-900 text-sm">Connect wallet</button>
            <button onClick={onLaunch} className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg text-sm font-medium">Launch app</button>
          </div>
        </div>
        <div className="border-t border-zinc-800/50 bg-black/50">
          <div className="max-w-7xl mx-auto px-5 py-1.5 flex items-center gap-5 text-xs overflow-x-auto whitespace-nowrap" aria-label="Live prices">
            {strip.length === 0 ? (
              <span className="text-zinc-500">Connecting to live prices...</span>
            ) : (
              strip.map((t) => (
                <span key={t.base} className="flex items-center gap-2">
                  <span className="font-semibold text-white">{t.base}</span>
                  <span className="text-zinc-300 tabular-nums">{formatPrice(t.price)}</span>
                  <span className={`tabular-nums ${pnlClass(t.change24hPct)}`}>{formatPct(t.change24hPct)}</span>
                </span>
              ))
            )}
            <span className="ml-auto pl-4"><LiveStatus /></span>
          </div>
        </div>
      </nav>

      <header className="relative pt-36 pb-20 px-5">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div className="order-2 md:order-1">
            <span className="inline-block px-4 py-1 mb-5 rounded-full text-xs font-semibold text-blue-300 bg-blue-600/10 border border-blue-500/20">Early access</span>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mb-6">
              Trade with live market intelligence,{' '}
              <span className="bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent">not guesses.</span>
            </h1>
            <p className="text-lg text-zinc-400 mb-7 min-h-[5.5rem]" aria-label={HEADLINE}>
              <span aria-hidden>{HEADLINE.slice(0, typed)}</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-7">
              <button onClick={onLaunch} className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-semibold shadow-lg shadow-blue-600/20">Open the dashboard</button>
              <button onClick={onOpenWallet} className="px-6 py-3 border border-zinc-700 text-zinc-200 hover:bg-zinc-900 rounded-lg font-medium">Connect wallet</button>
            </div>
            <WaitlistForm />

            <dl className="mt-9 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
                  <dd className="text-lg font-bold text-white tabular-nums min-h-[1.75rem]">{s.value ?? <span className="text-zinc-600">...</span>}</dd>
                  <dt className="text-xs text-zinc-500">{s.label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-zinc-600">Live market snapshot from CoinGecko and Alternative.me.</p>
          </div>

          <div className="order-1 md:order-2">
            <div className="rounded-2xl overflow-hidden shadow-2xl bg-zinc-900 border border-zinc-800">
              <div className="px-4 py-3 flex items-center justify-between bg-zinc-950">
                <div className="flex items-center gap-2" aria-hidden>
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <span className="text-xs text-zinc-400">Live preview</span>
              </div>
              <div className="p-5">
                <div className="rounded-lg p-4 bg-gradient-to-br from-indigo-900/60 to-cyan-800/30">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-zinc-300">BTC / USDT</p>
                      <p className="text-3xl font-bold tabular-nums min-h-[2.25rem]">{btc ? formatPrice(btc.price) : <span className="text-zinc-500">...</span>}</p>
                      {btc && <p className={`text-sm tabular-nums ${pnlClass(btc.change24hPct)}`}>{formatPct(btc.change24hPct)} in 24h</p>}
                    </div>
                    {btc && (
                      <dl className="text-right text-xs text-zinc-300">
                        <dt>24h high</dt><dd className="font-semibold tabular-nums mb-1">{formatPrice(btc.high24h)}</dd>
                        <dt>24h low</dt><dd className="font-semibold tabular-nums">{formatPrice(btc.low24h)}</dd>
                      </dl>
                    )}
                  </div>
                  {btcCoin && btcCoin.sparkline7d.length > 2 ? (
                    <svg viewBox="0 0 170 36" className="w-full h-16 mt-3" role="img" aria-label="Bitcoin price over the last 7 days">
                      <path d={sparklinePath(btcCoin.sparkline7d)} fill="none" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <div className="h-16 mt-3" />
                  )}
                  <p className="text-[11px] text-zinc-400">7 day price</p>
                </div>

                <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Top movers, 24h</p>
                <ul className="space-y-1.5 min-h-[7rem]">
                  {movers.length === 0 && <li className="text-sm text-zinc-600">Loading...</li>}
                  {movers.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-zinc-800/50">
                      <span className="font-medium">{c.symbol} <span className="text-zinc-500 font-normal">{c.name}</span></span>
                      <span className={`tabular-nums ${pnlClass(c.change24h)}`}>{formatPct(c.change24h)}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={onLaunch} className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">
                  Open the terminal <ArrowRight className="w-4 h-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section id="features" className="relative py-20 px-5 bg-zinc-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-bold mb-3">What you get</h2>
            <p className="text-lg text-zinc-400">Six tools, one workspace, all fed by live data.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, text, gradient }) => (
              <article key={title} className="p-7 rounded-2xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 transition-colors">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-5 shadow-lg`}>
                  <Icon className="w-7 h-7 text-white" aria-hidden />
                </div>
                <h3 className="text-xl font-bold mb-2">{title}</h3>
                <p className="text-zinc-400 leading-relaxed">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="relative py-20 px-5">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl font-bold mb-5">Built for traders who want signal, not noise</h2>
            <p className="text-lg text-zinc-400 mb-4">
              Arctos pulls prices, order books, on chain transfers, new token launches and headlines into a single screen, so you can see what is moving and why.
            </p>
            <p className="text-lg text-zinc-400 mb-6">
              Trading in Arctos is paper trading for now. You can test ideas against live prices, keep a trade book, and ask the assistant for a second opinion without risking funds.
            </p>
            <button onClick={onLaunch} className="px-7 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">Start exploring</button>
          </div>
          <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
            <p className="text-sm font-semibold text-zinc-300 mb-4">Right now, in memory</p>
            <dl className="grid grid-cols-2 gap-4">
              {[
                ['Coins tracked', status.data?.data.coins],
                ['Live trading pairs', status.data?.data.tickers],
                ['Headlines indexed', status.data?.data.newsArticles],
                ['Whale transfers seen', status.data?.data.whaleEvents],
              ].map(([label, value]) => (
                <div key={String(label)} className="p-4 rounded-xl bg-zinc-800/50">
                  <dd className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : <span className="text-zinc-600">...</span>}</dd>
                  <dt className="text-xs text-zinc-500 mt-1">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-zinc-600">Counts come straight from the Arctos data service.</p>
          </div>
        </div>
      </section>

      <section className="relative py-20 px-5 bg-zinc-950">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">Get early access</h2>
          <p className="text-lg text-zinc-400 mb-8">Leave your email and we will tell you when new features open up.</p>
          <WaitlistForm compact />
        </div>
      </section>

      <footer id="contact" className="relative py-12 px-5 bg-black border-t border-zinc-800">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-10 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <img src={arctosLogo} alt="" className="w-10 h-10 object-contain" />
                <span className="text-2xl font-bold">Arctos</span>
              </div>
              <p className="text-zinc-400 mb-5 max-w-md">Live market intelligence for crypto traders. Nothing here is financial advice.</p>
              <div className="flex gap-3">
                {[
                  { href: SOCIAL.x, label: 'Arctos on X', Icon: Twitter },
                  { href: SOCIAL.github, label: 'Arctos on GitHub', Icon: Github },
                  { href: SOCIAL.telegram, label: 'Arctos on Telegram', Icon: Send },
                ].map(({ href, label, Icon }) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="w-10 h-10 rounded-lg bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-zinc-400" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-bold mb-3">Product</h3>
              <ul className="space-y-2">
                <li><button className={nav} onClick={() => scrollTo('features')}>Features</button></li>
                <li><button className={nav} onClick={onLaunch}>Dashboard</button></li>
                <li><a className={nav} href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">Documentation</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold mb-3">Legal</h3>
              <ul className="space-y-2">
                <li><button className={nav} onClick={() => setLegal('privacy')}>Privacy</button></li>
                <li><button className={nav} onClick={() => setLegal('terms')}>Terms of use</button></li>
                <li><button className={nav} onClick={() => setLegal('risk')}>Risk disclosure</button></li>
              </ul>
            </div>
          </div>
          <p className="pt-6 border-t border-zinc-800 text-sm text-zinc-500">&copy; {new Date().getFullYear()} Arctos. All rights reserved.</p>
        </div>
      </footer>
      <LegalDialog topic={legal} onClose={() => setLegal(null)} />
    </div>
  );
}
