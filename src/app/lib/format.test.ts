import { describe, expect, it } from 'vitest';
import { formatCompactUsd, formatPct, formatPrice, safeHref, shortAddress, sparklinePath, timeAgo } from './format';

describe('format', () => {
  it('keeps precision for tiny prices and handles missing values', () => {
    expect(formatPrice(65000.5)).toBe('$65,000.50');
    expect(formatPrice(0.5)).toBe('$0.50');
    expect(formatPrice(0.1234)).toBe('$0.1234');
    expect(formatPrice(0.00001234)).toMatch(/^\$0\.0000123/);
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(Number.NaN)).toBe('—');
  });

  it('formats compact money and percentages', () => {
    expect(formatCompactUsd(3.25e12)).toBe('$3.25T');
    expect(formatCompactUsd(1_500_000)).toBe('$1.50M');
    expect(formatPct(1.234)).toBe('+1.23%');
    expect(formatPct(-0.5)).toBe('-0.50%');
    expect(formatPct(undefined)).toBe('—');
  });

  it('describes elapsed time', () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 2000, now)).toBe('just now');
    expect(timeAgo(now - 90_000, now)).toBe('1m ago');
    expect(timeAgo(now - 7_300_000, now)).toBe('2h ago');
  });

  it('only allows web links', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('not a url')).toBeUndefined();
  });

  it('shortens addresses and builds sparklines', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(sparklinePath([1])).toBe('');
    expect(sparklinePath([1, 2, 3]).startsWith('M 0.0')).toBe(true);
  });
});
