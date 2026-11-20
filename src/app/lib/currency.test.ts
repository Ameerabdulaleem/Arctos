import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chosenCurrency, currencySymbol, getCurrency, loadRates, setCurrency, suggestedCurrency } from './currency';
import { formatCompactUsd, formatDollarPrice, formatDollars, formatPrice, formatUsd, toDisplay } from './format';

describe('display currency', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ base: 'USD', rates: { USD: 1, NGN: 1349.97, CAD: 1.4, EUR: 0.91, BAD: -1, 'x<y': 3 }, date: '2026-11-20' }), { status: 200 })));
    await loadRates(true);
  });

  afterAll(() => {
    setCurrency('USD');
    vi.unstubAllGlobals();
  });

  it('starts in dollars', () => {
    setCurrency('USD');
    expect(formatUsd(10)).toBe('$10.00');
    expect(formatCompactUsd(1_500_000)).toBe('$1.50M');
  });

  it('shows naira with its own sign, converted at the day rate', () => {
    setCurrency('NGN');
    expect(getCurrency()).toEqual({ code: 'NGN', rate: 1349.97 });
    expect(formatUsd(10)).toBe('₦13,499.70');
    expect(formatPrice(0.5)).toBe('₦674.99');
    expect(formatCompactUsd(1e9)).toBe('₦1.35T');
    expect(formatCompactUsd(2e12)).toBe('₦2700T');
    expect(toDisplay(2)).toBeCloseTo(2699.94, 6);
    expect(currencySymbol('NGN')).toBe('₦');
  });

  it('keeps dollar only amounts in dollars', () => {
    setCurrency('NGN');
    expect(formatDollars(10)).toBe('$10.00');
    expect(formatDollarPrice(65000.5)).toBe('$65,000.50');
  });

  it('writes other dollars so they cannot be mistaken for US dollars', () => {
    setCurrency('CAD');
    expect(formatUsd(10)).toBe('CA$14.00');
  });

  it('stays in dollars until a rate exists, and ignores bad codes and rates', () => {
    setCurrency('GHS');
    expect(chosenCurrency()).toBe('GHS');
    expect(getCurrency().code).toBe('USD');
    setCurrency('BAD');
    expect(getCurrency().code).toBe('USD');
    setCurrency('not a code');
    expect(chosenCurrency()).toBe('BAD');
  });

  it('suggests the currency of the browser region', () => {
    vi.stubGlobal('navigator', { languages: ['en-NG'], language: 'en-NG' });
    expect(suggestedCurrency()).toBe('NGN');
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    expect(suggestedCurrency()).toBeNull();
  });
});
