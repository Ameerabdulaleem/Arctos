// The currency amounts are shown in. Every amount the app works with stays in US dollars;
// this only changes how money is displayed, using daily exchange rates from the data service.

import { useSyncExternalStore } from 'react';
import { apiGet, isRecord } from '../services/api';

export interface DisplayCurrency {
  code: string;
  /** Units of `code` per US dollar. */
  rate: number;
}

const USD: DisplayCurrency = { code: 'USD', rate: 1 };
const CODE_KEY = 'arctos_currency';
const RATES_KEY = 'arctos_fx_rates';
/** Cached rates older than this are fetched again in the background. */
const REFRESH_AFTER_MS = 6 * 3600_000;

/** Shown first in the picker, in this order. */
export const POPULAR = ['USD', 'NGN', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR', 'CAD', 'INR', 'AED'];

interface RatesState {
  rates: Record<string, number>;
  date: string | null;
  at: number;
  loading: boolean;
  failed: boolean;
}

let chosen = 'USD';
let current: DisplayCurrency = USD;
let ratesState: RatesState = { rates: { USD: 1 }, date: null, at: 0, loading: false, failed: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CODE = /^[A-Z]{3}$/;

function validRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7;
}

/** Applies the chosen code once its rate is known; until then amounts stay in dollars. */
function recompute() {
  const rate = ratesState.rates[chosen];
  const next = chosen !== 'USD' && validRate(rate) ? { code: chosen, rate } : USD;
  if (next.code !== current.code || next.rate !== current.rate) current = next;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

function cleanRates(raw: unknown): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, number> = { USD: 1 };
  for (const [code, rate] of Object.entries(raw)) if (CODE.test(code) && validRate(rate)) out[code] = rate;
  return Object.keys(out).length > 1 ? out : null;
}

let inflight: Promise<void> | null = null;

/** Fetches today's rates. Safe to call often: one request at a time, and fresh rates are reused. */
export function loadRates(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && ratesState.at > 0 && Date.now() - ratesState.at < REFRESH_AFTER_MS && !ratesState.failed) return Promise.resolve();
  ratesState = { ...ratesState, loading: true, failed: false };
  emit();
  inflight = apiGet<{ rates: unknown; date?: unknown }>('/api/fx', { timeoutMs: 12_000, check: (v) => isRecord(v) && isRecord(v.rates) })
    .then((body) => {
      const rates = cleanRates(body.rates);
      if (!rates) throw new Error('no rates');
      ratesState = { rates, date: typeof body.date === 'string' ? body.date.slice(0, 10) : null, at: Date.now(), loading: false, failed: false };
      writeStorage(RATES_KEY, JSON.stringify({ rates, date: ratesState.date, at: ratesState.at }));
    })
    .catch(() => {
      ratesState = { ...ratesState, loading: false, failed: true };
    })
    .finally(() => {
      inflight = null;
      recompute();
      emit();
    });
  return inflight;
}

/** Reads the saved choice and rates, so the first screen already shows the right currency. */
export function initCurrency() {
  const saved = readStorage(CODE_KEY);
  if (saved && CODE.test(saved)) chosen = saved;
  try {
    const cached = JSON.parse(readStorage(RATES_KEY) ?? 'null') as { rates?: unknown; date?: unknown; at?: unknown } | null;
    const rates = cleanRates(cached?.rates);
    if (rates) ratesState = { rates, date: typeof cached?.date === 'string' ? cached.date : null, at: typeof cached?.at === 'number' ? cached.at : 0, loading: false, failed: false };
  } catch {
    /* a broken cache is simply ignored */
  }
  recompute();
  if (chosen !== 'USD') void loadRates();
}

export function setCurrency(code: string) {
  if (!CODE.test(code)) return;
  chosen = code;
  writeStorage(CODE_KEY, code);
  recompute();
  emit();
  if (code !== 'USD') void loadRates();
}

/** The currency amounts are shown in right now. */
export function getCurrency(): DisplayCurrency {
  return current;
}

/** The code the user picked, even while its rate is still loading. */
export function chosenCurrency(): string {
  return chosen;
}

/** Re-renders when the display currency changes. */
export function useCurrency(): DisplayCurrency {
  return useSyncExternalStore(subscribe, getCurrency, getCurrency);
}

/** The rates the picker lists, with their loading state. */
export function useRates(): RatesState {
  return useSyncExternalStore(subscribe, () => ratesState, () => ratesState);
}

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return null;
  }
})();

export function currencyName(code: string): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

const symbolCache = new Map<string, 'symbol' | 'narrowSymbol'>();

/**
 * How the currency's sign is written. The regular symbol is used when it is distinct
 * (CA$, CN¥, €), and the narrow one when the regular one would only repeat the code (₦ for NGN).
 */
export function symbolStyle(code: string): 'symbol' | 'narrowSymbol' {
  let style = symbolCache.get(code);
  if (!style) {
    try {
      const sign = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? code;
      style = sign === code ? 'narrowSymbol' : 'symbol';
    } catch {
      style = 'symbol';
    }
    symbolCache.set(code, style);
  }
  return style;
}

export function currencySymbol(code: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: symbolStyle(code) }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

// Countries that use one of the offered currencies, for the "suggested" entry in the picker.
const REGION_CURRENCY: Record<string, string> = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', UG: 'UGX', TZ: 'TZS', RW: 'RWF', ET: 'ETB', ZM: 'ZMW', EG: 'EGP', MA: 'MAD',
  SN: 'XOF', CI: 'XOF', BJ: 'XOF', TG: 'XOF', ML: 'XOF', BF: 'XOF', NE: 'XOF', CM: 'XAF', GA: 'XAF', CG: 'XAF', TD: 'XAF',
  GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', JP: 'JPY', CN: 'CNY', HK: 'HKD', SG: 'SGD', KR: 'KRW', IN: 'INR',
  PK: 'PKR', BD: 'BDT', ID: 'IDR', MY: 'MYR', PH: 'PHP', TH: 'THB', VN: 'VND', TR: 'TRY', AE: 'AED', SA: 'SAR', QA: 'QAR',
  KW: 'KWD', IL: 'ILS', BR: 'BRL', MX: 'MXN', AR: 'ARS', CO: 'COP', CL: 'CLP', PE: 'PEN', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', UA: 'UAH', RU: 'RUB',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', PT: 'EUR', IE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
};

/** The currency of the visitor's browser region, when it is one we offer and not the dollar. */
export function suggestedCurrency(): string | null {
  const langs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const lang of langs) {
    const region = lang?.split('-')[1]?.toUpperCase();
    const code = region ? REGION_CURRENCY[region] : undefined;
    if (code) return code;
  }
  return null;
}
