import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, CheckCircle, CircleNotch, Flask, GithubLogo, Lightning, RocketLaunch, ShieldCheck, TelegramLogo, Wallet, XLogo } from '@phosphor-icons/react';
import { toast } from 'sonner';
import arctosLogo from '../../assets/images/arctos-logo.png.png';
import type { ViewId } from '../hooks/useHashView';
import { LegalDialog, type LegalTopic } from './LegalDialog';
import { LiveStatus } from './LiveStatus';
import { IconTile, Skeleton } from './ui/common';
import { NAV_GROUPS } from './navigation';
import { useTickers } from '../hooks/useTickers';
import { usePolling } from '../hooks/usePolling';
import { marketService } from '../services/marketService';
import { statusService } from '../services/statusService';
import { EMAIL_PATTERN, waitlistService, type JoinResult } from '../services/waitlistService';
import { errorMessage } from '../services/api';
import { formatCompactUsd, formatPct, formatPrice, pnlClass, safeHref, sparklinePath } from '../lib/format';

interface Props {
  onLaunch: (view?: ViewId) => void;
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

const TOOLS = NAV_GROUPS.flatMap((group) => group.items);

const STEPS = [
  { icon: RocketLaunch, tone: 'ice' as const, title: 'Open the app', text: 'Get started takes you straight in. There is no sign up, no wallet and no waiting list in the way.' },
  { icon: Lightning, tone: 'amber' as const, title: 'Read the market', text: 'Prices, order books, whale transfers, new pools and headlines arrive from live sources as they change.' },
  { icon: Flask, tone: 'violet' as const, title: 'Practise with paper money', text: 'Place simulated orders against the real order book, keep a trade book, and ask the assistant for a second opinion.' },
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
      <div role="status" className={`flex items-center gap-2 text-emerald-300 ${compact ? 'justify-center' : ''}`}>
        <CheckCircle className="h-5 w-5 shrink-0" weight="fill" aria-hidden />
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
          className="field h-12 flex-1 rounded-2xl px-4"
        />
        <button type="submit" disabled={busy} className="btn btn-secondary h-12 rounded-2xl px-5">
          {busy ? <CircleNotch className="w-4 h-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Joining...' : 'Join waitlist'}
        </button>
      </form>
      {count !== null && count > 0 && <p className={`mt-2 text-xs text-zinc-500 ${compact ? 'text-center' : ''}`}>{count.toLocaleString()} {count === 1 ? 'person is' : 'people are'} on the list.</p>}
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
    const timer = setInterval(() => setTyped((n) => (n >= HEADLINE.length ? n : n + 1)), 22);
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
  const strip = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'].map((s) => tickers[s]).filter(Boolean);
  const link = 'text-sm text-zinc-400 transition hover:text-white';
  const spark = btcCoin && btcCoin.sparkline7d.length > 2 ? sparklinePath(btcCoin.sparkline7d, 420, 110) : '';
  const up = (btc?.change24hPct ?? 0) >= 0;
  const stroke = up ? '#34d399' : '#fb7185';

  return (
    <div className="relative min-h-dvh overflow-x-hidden text-zinc-100">
      <a href="#features" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-black">Skip to content</a>

      {/* Floating navigation */}
      <div className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <nav aria-label="Primary" className="glass mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-2xl px-3 sm:px-4">
          <div className="flex items-center gap-2.5">
            <img src={arctosLogo} alt="" className="h-8 w-8 rounded-lg object-contain" />
            <span className="text-[17px] font-semibold tracking-tight">Arctos</span>
          </div>
          <div className="hidden items-center gap-7 md:flex">
            <button className={link} onClick={() => scrollTo('features')}>Features</button>
            <button className={link} onClick={() => scrollTo('how')}>How it works</button>
            <button className={link} onClick={() => scrollTo('about')}>About</button>
            <button className={link} onClick={() => scrollTo('contact')}>Contact</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenWaitlist} className="btn btn-ghost btn-sm hidden h-9 sm:inline-flex">Join waitlist</button>
            <button onClick={onOpenWallet} className="btn btn-secondary btn-sm hidden h-9 lg:inline-flex">
              <Wallet className="h-4 w-4" aria-hidden /> Connect wallet
            </button>
            <button onClick={() => onLaunch()} className="btn btn-primary btn-sm h-9 px-4">Get started</button>
          </div>
        </nav>
      </div>

      {/* Hero */}
      <header className="relative px-5 pb-16 pt-12 sm:pt-16 lg:pb-24">
        <div className="pointer-events-none absolute inset-0 -top-24 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_62%,transparent)]" aria-hidden>
          <div className="bg-grid absolute inset-0" />
          <div className="aurora -left-24 top-10 h-[420px] w-[520px] bg-blue-500/20" />
          <div className="aurora right-[-120px] top-[-60px] h-[460px] w-[520px] bg-indigo-500/20 [animation-delay:-6s]" />
          <div className="aurora bottom-[-180px] left-1/3 h-[380px] w-[560px] bg-teal-400/10 [animation-delay:-11s]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="motion-safe:animate-fade-up">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="chip border-blue-300/25 bg-blue-400/10 text-blue-200">
                <Flask className="h-3.5 w-3.5" aria-hidden /> Paper trading is open
              </span>
              <LiveStatus />
            </div>
            <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-white [text-wrap:balance] sm:text-[56px] lg:text-[62px]">
              Trade with live market intelligence, <span className="text-gradient">not guesses.</span>
            </h1>
            <p className={`mt-6 min-h-[84px] max-w-xl text-lg leading-relaxed text-zinc-400 sm:min-h-[56px] ${typed < HEADLINE.length ? 'caret' : ''}`} aria-label={HEADLINE}>
              <span aria-hidden>{HEADLINE.slice(0, typed)}</span>
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => onLaunch()} className="btn btn-primary btn-lg group">
                Get started
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" weight="bold" aria-hidden />
              </button>
              <button onClick={onOpenWallet} className="btn btn-secondary btn-lg">
                <Wallet className="h-[18px] w-[18px]" aria-hidden /> Connect wallet
              </button>
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
              {['No sign up needed', 'No wallet required', 'Every number from a live source'].map((point) => (
                <li key={point} className="flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4 text-emerald-300" weight="fill" aria-hidden /> {point}
                </li>
              ))}
            </ul>

            <div className="mt-9">
              <p className="eyebrow mb-2.5">Get product updates</p>
              <WaitlistForm />
            </div>
          </div>

          {/* Live preview */}
          <div className="relative motion-safe:animate-fade-up [animation-delay:120ms]">
            <div className="absolute -inset-6 rounded-[36px] bg-gradient-to-br from-blue-400/20 via-transparent to-violet-500/20 blur-2xl" aria-hidden />
            <div className="ring-gradient relative overflow-hidden rounded-3xl bg-zinc-950/80 shadow-2xl shadow-black/60 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
                <div className="flex items-center gap-1.5" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                </div>
                <span className="eyebrow text-[10px]">Live preview</span>
              </div>

              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-zinc-400">BTC / USDT</p>
                    <p className="num mt-1 text-4xl font-semibold tracking-tight text-white">{btc ? formatPrice(btc.price) : <Skeleton className="h-9 w-48" />}</p>
                    {btc && <p className={`num mt-1 text-sm ${pnlClass(btc.change24hPct)}`}>{formatPct(btc.change24hPct)} in 24h</p>}
                  </div>
                  {btc && (
                    <dl className="num space-y-1 text-right text-xs">
                      <div><dt className="inline text-zinc-500">24h high </dt><dd className="inline text-zinc-200">{formatPrice(btc.high24h)}</dd></div>
                      <div><dt className="inline text-zinc-500">24h low </dt><dd className="inline text-zinc-200">{formatPrice(btc.low24h)}</dd></div>
                    </dl>
                  )}
                </div>

                <div className="mt-3 h-[110px]">
                  {spark ? (
                    <svg viewBox="0 0 420 110" className="h-full w-full" preserveAspectRatio="none" role="img" aria-label="Bitcoin price over the last 7 days">
                      <defs>
                        <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
                          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={`${spark} L420,110 L0,110 Z`} fill="url(#hero-fill)" />
                      <path d={spark} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </svg>
                  ) : (
                    <Skeleton className="h-full w-full rounded-xl" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">7 day price</p>

                <div className="mt-4">
                  <p className="eyebrow mb-2 text-[10px]">Top movers, 24h</p>
                  <ul className="grid grid-cols-2 gap-2">
                    {movers.length === 0 && [0, 1, 2, 3].map((i) => <li key={i}><Skeleton className="h-11 w-full rounded-xl" /></li>)}
                    {movers.map((c) => (
                      <li key={c.id} className="panel-inset flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="min-w-0 truncate text-sm"><span className="font-semibold text-white">{c.symbol}</span> <span className="text-zinc-500">{c.name}</span></span>
                        <span className={`num shrink-0 text-sm ${pnlClass(c.change24h)}`}>{formatPct(c.change24h)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button onClick={() => onLaunch('trading')} className="btn btn-primary mt-4 h-11 w-full">
                  Open the terminal <ArrowRight className="h-4 w-4" weight="bold" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Live price strip */}
        <div className="relative mx-auto mt-14 max-w-6xl">
          <div className="panel flex items-center gap-1 overflow-x-auto px-2 py-2" aria-label="Live prices">
            {strip.length === 0 && <span className="px-3 py-1.5 text-sm text-zinc-500">Waiting for live prices...</span>}
            {strip.map((t) => (
              <span key={t.symbol} className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm">
                <span className="font-semibold text-zinc-200">{t.base}</span>
                <span className="num text-white">{formatPrice(t.price)}</span>
                <span className={`num text-xs ${pnlClass(t.change24hPct)}`}>{formatPct(t.change24hPct)}</span>
              </span>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="panel px-5 py-4">
                <dt className="text-xs text-zinc-500">{s.label}</dt>
                <dd className="num mt-1.5 text-2xl font-semibold tracking-tight text-white">{s.value ?? <Skeleton className="h-7 w-24" />}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-zinc-600">Live market snapshot from CoinGecko and Alternative.me.</p>
        </div>
      </header>

      {/* Tools */}
      <section id="features" className="relative scroll-mt-24 px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="eyebrow mb-3 text-blue-300">The workspace</p>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[40px] sm:leading-[1.1]">Eight tools, one screen, all fed by live data.</h2>
            <p className="mt-4 text-lg text-zinc-400">Pick any tool to open it now. Nothing is locked.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id} onClick={() => onLaunch(tool.id)}
                  className="panel panel-hover group relative flex flex-col items-start overflow-hidden p-5 text-left hover:-translate-y-0.5"
                >
                  <IconTile tone={tool.tone} size="lg"><Icon /></IconTile>
                  <h3 className="mt-5 text-[17px] font-semibold text-white">{tool.label}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{tool.blurb}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition group-hover:text-blue-300">
                    Open <ArrowUpRight className="h-3.5 w-3.5" weight="bold" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="ring-gradient mt-4 flex flex-col gap-4 rounded-2xl bg-gradient-to-r from-emerald-400/[0.07] via-white/[0.02] to-blue-400/[0.07] p-5 sm:flex-row sm:items-center">
            <IconTile tone="mint" size="lg"><ShieldCheck /></IconTile>
            <div>
              <h3 className="text-[17px] font-semibold text-white">Honest by design</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">Every number on screen comes from a live source. When a source is down we tell you instead of showing made up data.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative scroll-mt-24 px-5 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="eyebrow mb-3 text-blue-300">How it works</p>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[40px] sm:leading-[1.1]">From landing page to live market in one click.</h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, tone, title, text }, i) => (
              <li key={title} className="panel relative p-6">
                <span className="num absolute right-5 top-4 text-5xl font-semibold text-white/[0.05]" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                <IconTile tone={tone} size="lg"><Icon /></IconTile>
                <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* About */}
      <section id="about" className="relative scroll-mt-24 px-5 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow mb-3 text-blue-300">About</p>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[40px] sm:leading-[1.1]">Built for traders who want signal, not noise</h2>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">
              Arctos pulls prices, order books, on chain transfers, new token launches and headlines into a single screen, so you can see what is moving and why.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-zinc-400">
              Trading in Arctos is paper trading for now. You can test ideas against live prices, keep a trade book, and ask the assistant for a second opinion without risking funds.
            </p>
            <button onClick={() => onLaunch()} className="btn btn-primary btn-lg mt-7">Get started</button>
          </div>
          <div className="panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-200">Right now, in the data service</p>
              <LiveStatus />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {[
                ['Coins tracked', status.data?.data.coins],
                ['Live trading pairs', status.data?.data.tickers],
                ['Headlines indexed', status.data?.data.newsArticles],
                ['Whale transfers seen', status.data?.data.whaleEvents],
              ].map(([label, value]) => (
                <div key={String(label)} className="panel-inset p-4">
                  <dd className="num text-3xl font-semibold tracking-tight text-white">{typeof value === 'number' ? value.toLocaleString() : <Skeleton className="h-8 w-14" />}</dd>
                  <dt className="mt-1 text-xs text-zinc-500">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-zinc-600">Counts come straight from the Arctos data service.</p>
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="relative px-5 py-20">
        <div className="ring-gradient relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-zinc-950/70 px-6 py-14 text-center backdrop-blur-xl">
          <div className="aurora left-1/2 top-[-140px] h-[280px] w-[620px] -translate-x-1/2 bg-blue-400/20" aria-hidden />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[40px] sm:leading-[1.1]">Get early access</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-400">Leave your email and we will tell you when new features open up.</p>
            <div className="mt-8"><WaitlistForm compact /></div>
          </div>
        </div>
      </section>

      <footer id="contact" className="relative scroll-mt-24 border-t border-white/[0.06] px-5 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="mb-3 flex items-center gap-3">
                <img src={arctosLogo} alt="" className="h-10 w-10 rounded-xl object-contain" />
                <span className="text-2xl font-semibold tracking-tight">Arctos</span>
              </div>
              <p className="mb-5 max-w-md text-zinc-400">Live market intelligence for crypto traders. Nothing here is financial advice.</p>
              <div className="flex gap-2">
                {[
                  { href: SOCIAL.x, label: 'Arctos on X', Icon: XLogo },
                  { href: SOCIAL.github, label: 'Arctos on GitHub', Icon: GithubLogo },
                  { href: SOCIAL.telegram, label: 'Arctos on Telegram', Icon: TelegramLogo },
                ].map(({ href, label, Icon }) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="btn btn-secondary btn-icon h-10 w-10 text-zinc-300">
                    <Icon className="h-5 w-5" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-white">Product</h3>
              <ul className="space-y-2">
                <li><button className={link} onClick={() => scrollTo('features')}>Features</button></li>
                <li><button className={link} onClick={() => onLaunch()}>Dashboard</button></li>
                <li><a className={link} href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">Documentation</a></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-white">Legal</h3>
              <ul className="space-y-2">
                <li><button className={link} onClick={() => setLegal('privacy')}>Privacy</button></li>
                <li><button className={link} onClick={() => setLegal('terms')}>Terms of use</button></li>
                <li><button className={link} onClick={() => setLegal('risk')}>Risk disclosure</button></li>
              </ul>
            </div>
          </div>
          <p className="border-t border-white/[0.06] pt-6 text-sm text-zinc-500">&copy; {new Date().getFullYear()} Arctos. All rights reserved.</p>
        </div>
      </footer>
      <LegalDialog topic={legal} onClose={() => setLegal(null)} />
    </div>
  );
}
