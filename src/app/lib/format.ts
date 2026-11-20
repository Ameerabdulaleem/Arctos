import { getCurrency, symbolStyle } from './currency';

// Money arrives in US dollars everywhere. These formatters show it in the currency the user
// picked (see currency.ts), converting with the day's rate. The `Dollars` variants never convert.

const fmtCache = new Map<string, Intl.NumberFormat>();

function money(code: string, maxFraction: number, minFraction?: number, compact = false): Intl.NumberFormat {
  const key = `${code}|${maxFraction}|${minFraction ?? ''}|${compact}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: symbolStyle(code),
      maximumFractionDigits: maxFraction,
      ...(minFraction != null ? { minimumFractionDigits: minFraction } : {}),
      ...(compact ? { notation: 'compact' as const } : {}),
    });
    fmtCache.set(key, f);
  }
  return f;
}

function priceIn(code: string, value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1) return money(code, 2).format(value);
  if (abs >= 0.01) return money(code, 4).format(value);
  if (abs === 0) return money(code, 2, 2).format(0);
  // Sub cent prices: show four significant digits.
  const digits = Math.min(12, Math.max(6, -Math.floor(Math.log10(abs)) + 3));
  return money(code, digits, digits).format(value);
}

function compactIn(code: string, value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e14) return money(code, 0, 0, true).format(value);
  if (abs >= 1e6) return money(code, 2, 2, true).format(value);
  if (abs >= 1e3) return money(code, 1, 1, true).format(value);
  return money(code, 2, 2).format(value);
}

/** A US dollar amount converted into the display currency. */
export function toDisplay(usd: number): number {
  return usd * getCurrency().rate;
}

/** Price style formatting that keeps useful precision for tiny values. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const { code, rate } = getCurrency();
  return priceIn(code, value * rate);
}

export function formatUsd(value: number | null | undefined, maxFraction = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const { code, rate } = getCurrency();
  return money(code, maxFraction).format(value * rate);
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const { code, rate } = getCurrency();
  return compactIn(code, value * rate);
}

/** Always in US dollars, for places priced in dollars such as the USDT practice account. */
export function formatDollars(value: number | null | undefined, maxFraction = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return money('USD', maxFraction).format(value);
}

/** Price style formatting, always in US dollars. */
export function formatDollarPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return priceIn('USD', value);
}

export function formatNumber(value: number | null | undefined, maxFraction = 4): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFraction }).format(value);
}

export function formatPct(value: number | null | undefined, digits = 2, withSign = true): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function pnlClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return 'text-zinc-400';
  return value > 0 ? 'text-emerald-300' : 'text-rose-300';
}

export function timeAgo(from: number | Date | string, now: number = Date.now()): string {
  const t = from instanceof Date ? from.getTime() : typeof from === 'string' ? Date.parse(from) : from;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function shortAddress(addr: string | null | undefined, head = 6, tail = 4): string {
  if (!addr) return '';
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Only allow web links from external data into href attributes. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Builds an SVG polyline path for a small sparkline. */
export function sparklinePath(series: number[], width = 170, height = 36): string {
  const clean = series.filter((n) => Number.isFinite(n));
  if (clean.length < 2) return '';
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const range = max - min || 1;
  const step = width / (clean.length - 1);
  return clean
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((p - min) / range) * height).toFixed(1)}`)
    .join(' ');
}
