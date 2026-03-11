// ─── AIChat ───────────────────────────────────────────────────────────────────
// Production-ready AI Trading Advisor component.
//
// Features:
//   - Gemini 1.5 Flash integration (free tier, no credit card required)
//   - Live context injection: TradeBook stats, Sniper tokens, News headlines
//   - Slim collapsible context panel (desktop)
//   - Markdown-lite renderer (bold, inline code, bullet lists)
//   - Auto-growing textarea (Enter = send, Shift+Enter = newline)
//   - Copy-to-clipboard on any message (hover reveal)
//   - Animated typing indicator
//   - Quick-prompt chips for common queries
//   - Graceful error states with actionable guidance
//   - API key status pill (green = connected, amber = missing)
// ─────────────────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Newspaper,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import { useAIContext, type AIContextData } from '@/app/hooks/useAIContext';
import { aiService, type GeminiMessage } from '@/app/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  role: 'user' | 'ai';
  timestamp: Date;
  isError?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  'Analyze my overall trade performance',
  'Which sniper tokens look promising?',
  'Summarize high-impact news for me',
  'What is my biggest risk right now?',
  'Suggest a position sizing strategy',
];

const INITIAL_MESSAGE: Message = {
  id: 'init',
  text:
    "Hello! I'm your **Arctos AI Trading Advisor**. I have real-time access to your trade book, sniper engine, and market news, so my advice is tailored to your actual data.\n\nAsk me anything: portfolio review, token analysis, risk assessment, or market outlook.",
  role: 'ai',
  timestamp: new Date(),
};

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AIContextData): string {
  const fmtUSD = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

  const tradelines = ctx.trades
    .slice(0, 8)
    .map((t) => {
      const open = !t.priceSold || parseFloat(t.priceSold) === 0;
      const invested = (parseFloat(t.priceBought) * parseFloat(t.amount)).toFixed(2);
      return `  • ${t.tokenName}: bought ${fmtUSD(parseFloat(t.priceBought))} × ${t.amount} | invested ${fmtUSD(parseFloat(invested))} | ${
        open
          ? 'OPEN'
          : `closed ${fmtUSD(parseFloat(t.priceSold))} → P/L ${fmtUSD(t.profitLoss)}`
      }`;
    })
    .join('\n');

  const sniperlines = ctx.sniperTokens
    .slice(0, 6)
    .map(
      (t) =>
        `  • ${t.symbol} (${t.chain}): ${fmtUSD(t.price)}, ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}% 24h | liq ${fmtUSD(t.liquidityUsd)} | holders ${t.holders.toLocaleString()} | status: ${t.status}`,
    )
    .join('\n');

  const newslines = ctx.recentNews
    .slice(0, 5)
    .map((n) => `  • [${n.impact.toUpperCase()}] ${n.title} — ${n.source.name}`)
    .join('\n');

  return `You are an elite crypto trading AI advisor embedded in Arctos — a professional DeFi trading platform. You are precise, data-driven, risk-aware, and give actionable advice.

IMPORTANT RULES:
- Always ground your advice in the user's actual data shown below
- Use bullet points and clear structure for readability
- Flag risks explicitly with a "⚠ Risk:" prefix
- Never present analysis as guaranteed financial advice — frame it as analysis
- If data is mock/demo mode, note this briefly but still provide useful analysis
- Be concise. Avoid filler phrases.

═══ USER CONTEXT ═══

WALLET:
  Address : ${ctx.walletAddress ?? 'Not connected'}
  Status  : ${ctx.isWalletConnected ? 'Wallet connected' : 'No wallet connected'}

TRADE BOOK (${ctx.tradeStats.total} total trades):
  Open / Closed : ${ctx.tradeStats.open} / ${ctx.tradeStats.closed}
  Win Rate      : ${ctx.tradeStats.winRate}${ctx.tradeStats.closed > 0 ? ` (${ctx.tradeStats.winningTrades}W / ${ctx.tradeStats.closed - ctx.tradeStats.winningTrades}L)` : ''}
  Net P/L       : ${fmtUSD(ctx.tradeStats.netPL)}
  Total Profit  : ${fmtUSD(ctx.tradeStats.totalProfit)}
  Total Loss    : ${fmtUSD(ctx.tradeStats.totalLoss)}
Recent trades:
${tradelines || '  No trades recorded'}

SNIPER ENGINE (${ctx.sniperTokens.length} tracked tokens):
${sniperlines || '  No tokens tracked'}

RECENT MARKET NEWS:
${newslines || '  No news data available'}
═══════════════════`;
}

// ─── Markdown-lite renderer ───────────────────────────────────────────────────
// Handles: **bold**, `code`, bullet lists (- or •), line breaks.

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-zinc-700/80 text-blue-300 px-1.5 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => {
        const bulletMatch = /^(\s*)([-•*])\s+(.+)$/.exec(line);
        if (bulletMatch) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-blue-400 mt-0.5 shrink-0 select-none">·</span>
              <span>{renderInline(bulletMatch[3])}</span>
            </div>
          );
        }
        if (/^[═─]{3,}$/.test(line.trim())) {
          return <hr key={i} className="border-zinc-700 my-1" />;
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContextRow({
  label,
  value,
  valueClass = 'text-zinc-200',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center text-xs py-0.5">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 items-end">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-bl-sm px-5 py-3.5">
        <div className="flex gap-1.5 items-center">
          {[0, 160, 320].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIChat() {
  const aiCtx = useAIContext();
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const hasApiKey = apiKey.trim().length > 0;

  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        text: trimmed,
        role: 'user',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      setIsLoading(true);

      try {
        const history: GeminiMessage[] = messages
          .filter((m) => !m.isError && m.id !== 'init')
          .map((m) => ({
            role: m.role === 'ai' ? 'model' : 'user',
            parts: [{ text: m.text }],
          }));

        history.push({ role: 'user', parts: [{ text: trimmed }] });

        const systemPrompt = buildSystemPrompt(aiCtx);
        const responseText = await aiService.sendMessage(history, systemPrompt, apiKey);

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            text: responseText,
            role: 'ai',
            timestamp: new Date(),
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            text: aiService.formatError(err),
            role: 'ai',
            timestamp: new Date(),
            isError: true,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, apiKey, aiCtx],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-black overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-900/40">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight tracking-tight">
              AI Trading Advisor
            </h1>
            <p className="text-zinc-500 text-xs">Gemini 1.5 Flash · Context-aware</p>
          </div>
        </div>

        <span
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${
            hasApiKey
              ? 'bg-green-500/10 text-green-400 border-green-500/25'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              hasApiKey ? 'bg-green-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          {hasApiKey ? 'AI Connected' : 'API Key Required'}
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Context Sidebar (desktop only) ─────────────────────────────────── */}
        <aside className="hidden lg:flex w-60 border-r border-zinc-800 flex-col shrink-0">
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <span>Live Context</span>
            {contextOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {contextOpen && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* Trade Book */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                  <p className="text-zinc-400 text-[11px] font-semibold uppercase tracking-widest">
                    Trade Book
                  </p>
                </div>
                <div className="pl-1 space-y-0.5">
                  <ContextRow label="Total" value={String(aiCtx.tradeStats.total)} />
                  <ContextRow
                    label="Open / Closed"
                    value={`${aiCtx.tradeStats.open} / ${aiCtx.tradeStats.closed}`}
                  />
                  <ContextRow label="Win Rate" value={aiCtx.tradeStats.winRate} />
                  <ContextRow
                    label="Net P/L"
                    value={`$${aiCtx.tradeStats.netPL.toFixed(2)}`}
                    valueClass={aiCtx.tradeStats.netPL >= 0 ? 'text-green-400' : 'text-red-400'}
                  />
                  <ContextRow
                    label="Total Profit"
                    value={`$${aiCtx.tradeStats.totalProfit.toFixed(2)}`}
                    valueClass="text-green-500"
                  />
                  <ContextRow
                    label="Total Loss"
                    value={`$${aiCtx.tradeStats.totalLoss.toFixed(2)}`}
                    valueClass="text-red-500"
                  />
                </div>
              </section>

              <hr className="border-zinc-800" />

              {/* Sniper */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <p className="text-zinc-400 text-[11px] font-semibold uppercase tracking-widest">
                    Sniper Engine
                  </p>
                </div>
                <div className="pl-1">
                  <ContextRow
                    label="Tracked Tokens"
                    value={String(aiCtx.sniperTokens.length)}
                  />
                  {aiCtx.sniperTokens.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex justify-between items-center text-xs py-0.5">
                      <span className="text-zinc-500">{t.symbol}</span>
                      <span className={`font-medium ${t.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <hr className="border-zinc-800" />

              {/* News */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Newspaper className="w-3.5 h-3.5 text-violet-400" />
                  <p className="text-zinc-400 text-[11px] font-semibold uppercase tracking-widest">
                    Latest News
                  </p>
                </div>
                <div className="pl-1 space-y-2">
                  {aiCtx.recentNews.slice(0, 3).map((n, i) => (
                    <div key={i}>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mr-1 ${
                          n.impact === 'high'
                            ? 'bg-red-500/20 text-red-400'
                            : n.impact === 'medium'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}
                      >
                        {n.impact}
                      </span>
                      <span className="text-zinc-500 text-xs leading-relaxed line-clamp-2" title={n.title}>
                        {n.title}
                      </span>
                    </div>
                  ))}
                  {aiCtx.recentNews.length === 0 && (
                    <p className="text-zinc-600 text-xs">No news data loaded</p>
                  )}
                </div>
              </section>

              {/* Market pulse */}
              {aiCtx.sniperTokens.length > 0 && (
                <>
                  <hr className="border-zinc-800" />
                  <section>
                    <p className="text-zinc-400 text-[11px] font-semibold uppercase tracking-widest mb-2">
                      Market Pulse
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1 text-center p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <TrendingUp className="w-3.5 h-3.5 text-green-400 mx-auto mb-1" />
                        <p className="text-green-400 text-xs font-bold">
                          {aiCtx.sniperTokens.filter((t) => t.change24h >= 0).length}
                        </p>
                        <p className="text-zinc-600 text-[10px]">Bullish</p>
                      </div>
                      <div className="flex-1 text-center p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
                        <p className="text-red-400 text-xs font-bold">
                          {aiCtx.sniperTokens.filter((t) => t.change24h < 0).length}
                        </p>
                        <p className="text-zinc-600 text-[10px]">Bearish</p>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </aside>

        {/* ── Chat Column ──────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* API key warning */}
            {!hasApiKey && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-amber-300 font-semibold text-sm mb-1">
                    API Key Not Configured
                  </p>
                  <p className="text-amber-200/60 text-xs leading-relaxed">
                    Add{' '}
                    <code className="bg-zinc-800 text-amber-300 px-1 rounded">
                      VITE_GEMINI_API_KEY=your_key
                    </code>{' '}
                    to your{' '}
                    <code className="bg-zinc-800 px-1 rounded">.env</code> file, then restart
                    the dev server. Get a free key at{' '}
                    <span className="underline text-amber-300/80">aistudio.google.com</span>.
                  </p>
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 group ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.role === 'ai'
                      ? 'bg-gradient-to-br from-blue-600 to-violet-600'
                      : 'bg-zinc-700 border border-zinc-600'
                  }`}
                >
                  {msg.role === 'ai' ? (
                    <Sparkles className="w-4 h-4 text-white" />
                  ) : (
                    <User className="w-4 h-4 text-zinc-300" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={`relative flex flex-col max-w-[76%] ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`relative rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : msg.isError
                        ? 'bg-red-500/10 border border-red-500/25 text-red-300 rounded-tl-sm'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'ai' ? (
                      <RenderMarkdown text={msg.text} />
                    ) : (
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                    )}

                    {/* Copy button */}
                    <button
                      onClick={() => handleCopy(msg.id, msg.text)}
                      className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                      title="Copy"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  <span className="text-zinc-600 text-[11px] mt-1.5 px-1">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && <TypingIndicator />}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Quick prompts ───────────────────────────────────────────────────── */}
          <div className="px-6 pt-3 pb-2 border-t border-zinc-800/60 flex gap-2 flex-wrap">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => void sendMessage(p)}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-400 hover:border-blue-500/50 hover:text-blue-300 hover:bg-blue-500/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {p}
              </button>
            ))}
          </div>

          {/* ── Input ──────────────────────────────────────────────────────────── */}
          <div className="px-6 py-4 border-t border-zinc-800">
            <div className="flex gap-3 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your trades, sniper targets, market conditions..."
                  className="w-full bg-zinc-900 text-white px-4 py-3 pr-14 rounded-xl border border-zinc-700 focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/20 focus:outline-none resize-none text-sm placeholder:text-zinc-600 transition-colors"
                  style={{ minHeight: '48px', maxHeight: '140px' }}
                  disabled={isLoading}
                />
                {input.length > 0 && (
                  <span className="absolute right-4 bottom-3.5 text-zinc-600 text-[11px] select-none">
                    {input.length}
                  </span>
                )}
              </div>

              <button
                onClick={() => void sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="w-12 h-12 bg-blue-600 text-white rounded-xl hover:bg-blue-500 active:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-lg shadow-blue-900/30"
                title="Send (Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            <p className="text-zinc-700 text-[11px] mt-2 text-center select-none">
              Enter to send · Shift + Enter for new line · Context updates every 10 s
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
