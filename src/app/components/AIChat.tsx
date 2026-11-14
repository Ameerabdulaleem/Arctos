import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, Newspaper, PaperPlaneRight, Sparkle, Trash, TrendUp, User, WarningCircle } from '@phosphor-icons/react';
import { IconTile, Pill } from './ui/common';
import { useAIContext } from '../hooks/useAIContext';
import { usePolling } from '../hooks/usePolling';
import { useTickers } from '../hooks/useTickers';
import { useAuth } from '../contexts/auth-context';
import { usePaper } from '../contexts/paper-context';
import { aiService, type ChatTurn } from '../services/aiService';
import { marketService } from '../services/marketService';
import { newsService } from '../services/newsService';
import { portfolioService } from '../services/portfolioService';
import { errorMessage } from '../services/api';
import { formatPct, formatPrice, formatUsd, pnlClass } from '../lib/format';

interface Message {
  id: string;
  text: string;
  role: 'user' | 'ai';
  isError?: boolean;
}

const QUICK_PROMPTS = [
  'Give me a quick read on the market right now',
  'What are the biggest risks I should watch today?',
  'Summarize the most important headlines',
  'Review my paper trading performance',
  'Explain how to size a position with a 2% risk',
];

const WELCOME: Message = {
  id: 'welcome',
  role: 'ai',
  text: "Hi, I'm the Arctos assistant. I can see live prices, the Fear and Greed index, recent headlines and large whale transfers, plus your paper account and trade book.\n\nAsk me about the market, a token, or your trades. I can't place trades or touch your wallet.",
};

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="bg-zinc-700/80 text-blue-300 px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

// The reply is rendered as React text nodes only, never as HTML, so model output cannot inject markup.
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => {
        const bullet = /^(\s*)([-•*])\s+(.+)$/.exec(line);
        if (bullet) return <div key={i} className="flex gap-2 items-start"><span className="text-blue-300 mt-0.5 shrink-0 select-none">&middot;</span><span>{renderInline(bullet[3])}</span></div>;
        const heading = /^#{1,4}\s+(.+)$/.exec(line);
        if (heading) return <p key={i} className="font-semibold text-white pt-1">{renderInline(heading[1])}</p>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

export function AIChat() {
  const { user, isWalletConnected } = useAuth();
  const paper = usePaper();
  const { tickers } = useTickers();
  const address = isWalletConnected ? user?.walletAddress : undefined;
  const status = usePolling((s) => aiService.status(s), 60_000);
  const overview = usePolling((s) => marketService.overview(s), 60_000);
  const news = usePolling((s) => newsService.list(3, s), 120_000);
  const wallet = usePolling((s) => (address ? portfolioService.get(address, s) : Promise.resolve(null)), address ? 60_000 : null, [address]);
  const ai = useAIContext(wallet.data?.totalUsd ?? null);

  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const configured = status.data?.configured;

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    const history: ChatTurn[] = [...messages, userMsg]
      .filter((m) => m.id !== 'welcome' && !m.isError)
      .slice(-16)
      .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text.slice(0, 4000) }));
    abortRef.current = new AbortController();
    try {
      const { reply } = await aiService.chat(history, ai.context(), abortRef.current.signal);
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'ai', text: reply }]);
    } catch (e) {
      if (abortRef.current?.signal.aborted) return;
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'ai', isError: true, text: errorMessage(e, 'The assistant could not answer. Please try again.') }]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, ai]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const fng = overview.data?.fearGreed;
  const watch = ['BTC', 'ETH', 'SOL'].map((s) => tickers[s]).filter(Boolean);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <IconTile tone="violet"><Sparkle /></IconTile>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight text-white">AI Assistant</h1>
            <p className="text-xs text-zinc-500">Answers from live Arctos data</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 1 && <button onClick={() => setMessages([WELCOME])} className="btn btn-ghost btn-sm"><Trash className="h-3.5 w-3.5" aria-hidden />Clear</button>}
          {status.loading && !status.data ? <Pill tone="zinc">Checking</Pill> : configured ? <Pill tone="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Connected</Pill> : <Pill tone="amber">Not configured</Pill>}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:flex w-64 border-r border-white/[0.07] flex-col shrink-0 overflow-y-auto p-4 space-y-5" aria-label="Live context the assistant can see">
          <section>
            <p className="flex items-center gap-1.5 text-zinc-400 text-[11px] font-semibold uppercase tracking-widest mb-2"><TrendUp className="w-3.5 h-3.5 text-blue-300" aria-hidden />Market</p>
            <ul className="space-y-1 text-xs">
              {watch.map((t) => <li key={t.base} className="flex justify-between"><span className="text-zinc-500">{t.base}</span><span className="num"><span className="text-zinc-200">{formatPrice(t.price)}</span> <span className={pnlClass(t.change24hPct)}>{formatPct(t.change24hPct, 1)}</span></span></li>)}
              {fng && <li className="flex justify-between"><span className="text-zinc-500">Fear and Greed</span><span className="text-zinc-200">{fng.value} {fng.label}</span></li>}
              {watch.length === 0 && !fng && <li className="text-zinc-600">Loading...</li>}
            </ul>
          </section>
          <section>
            <p className="flex items-center gap-1.5 text-zinc-400 text-[11px] font-semibold uppercase tracking-widest mb-2"><Newspaper className="w-3.5 h-3.5 text-violet-300" aria-hidden />Headlines</p>
            <ul className="space-y-2">
              {news.data?.articles.map((a) => <li key={a.id} className="text-xs text-zinc-400 line-clamp-2" title={a.title}>{a.title}</li>)}
              {!news.data && <li className="text-xs text-zinc-600">Loading...</li>}
            </ul>
          </section>
          <section>
            <p className="text-zinc-400 text-[11px] font-semibold uppercase tracking-widest mb-2">Your data</p>
            <ul className="space-y-1 text-xs">
              <li className="flex justify-between"><span className="text-zinc-500">Paper equity</span><span className="text-zinc-200 num">{formatUsd(paper.equity)}</span></li>
              <li className="flex justify-between"><span className="text-zinc-500">Open positions</span><span className="text-zinc-200">{paper.positions.length}</span></li>
              <li className="flex justify-between"><span className="text-zinc-500">Wallet</span><span className="text-zinc-200">{wallet.data ? formatUsd(wallet.data.totalUsd) : address ? 'Loading' : 'Not connected'}</span></li>
            </ul>
          </section>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-5" aria-live="polite">
            {configured === false && (
              <div role="alert" className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <WarningCircle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" aria-hidden />
                <p className="text-amber-200/80 text-sm">The assistant is not set up on the server yet. Add <code className="bg-white/[0.06] px-1 rounded">ANTHROPIC_API_KEY</code> to the Arctos data service environment and restart it. Keys are never placed in the website.</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 group ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${m.role === 'ai' ? 'bg-gradient-to-br from-blue-600 to-violet-600' : 'bg-white/10 border border-zinc-600'}`}>
                  {m.role === 'ai' ? <Sparkle className="w-4 h-4 text-white" aria-hidden /> : <User className="w-4 h-4 text-zinc-300" aria-hidden />}
                </div>
                <div className={`relative max-w-[85%] md:max-w-[76%] rounded-2xl px-4 py-3 ${m.role === 'user' ? 'rounded-tr-sm border border-blue-300/30 bg-gradient-to-br from-blue-400/25 to-blue-600/15 text-white' : m.isError ? 'rounded-tl-sm border border-rose-400/25 bg-rose-400/10 text-rose-200' : 'rounded-tl-sm border border-white/[0.07] bg-white/[0.035] text-zinc-100'}`}>
                  {m.role === 'ai' ? <Markdown text={m.text} /> : <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>}
                  {m.role === 'ai' && m.id !== 'welcome' && !m.isError && (
                    <button onClick={() => copy(m.id, m.text)} aria-label="Copy answer" className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 bg-white/[0.06] border border-white/10 rounded-lg text-zinc-400 hover:text-zinc-200">
                      {copied === m.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-3 items-end" role="status" aria-label="The assistant is thinking">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center"><Sparkle className="w-4 h-4 text-white" aria-hidden /></div>
                <div className="panel rounded-bl-sm px-5 py-3.5 flex gap-1.5">
                  {[0, 160, 320].map((d) => <span key={d} className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-4 md:px-6 pt-3 pb-2 border-t border-white/[0.07] flex gap-2 flex-wrap">
            {QUICK_PROMPTS.map((p) => (
              <button key={p} onClick={() => void send(p)} disabled={busy || configured === false} className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-zinc-400 hover:border-blue-500/50 hover:text-blue-200 disabled:opacity-40 disabled:cursor-not-allowed">{p}</button>
            ))}
          </div>

          <div className="px-4 md:px-6 py-4 border-t border-white/[0.07]">
            <div className="flex gap-3 items-end">
              <label className="sr-only" htmlFor="chat-input">Message</label>
              <textarea
                id="chat-input" rows={1} value={input} maxLength={4000} disabled={busy || configured === false}
                onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
                onKeyDown={onKey} placeholder="Ask about the market, a token, or your trades"
                className="flex-1 bg-zinc-900 text-white px-4 py-3 rounded-xl border border-white/10 focus:border-blue-500/70 focus:outline-none resize-none text-sm placeholder:text-zinc-600 disabled:opacity-60"
                style={{ minHeight: 48, maxHeight: 140 }}
              />
              <button onClick={() => void send(input)} disabled={busy || !input.trim() || configured === false} aria-label="Send message" className="btn btn-primary w-12 h-12 shrink-0">
                <PaperPlaneRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-zinc-600 text-[11px] mt-2 text-center">Enter to send, Shift and Enter for a new line. Analysis only, not financial advice.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
