// Exact conversions between what the user types and token base units. No floating point.

import { formatUnits, parseUnits } from 'viem';

/** Keeps digits and one decimal point, at most `decimals` places. */
export function cleanAmountInput(text: string, decimals: number): string {
  let s = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  if (s.startsWith('.')) s = `0${s}`;
  if (dot !== -1) {
    const [whole, frac = ''] = s.split('.');
    s = `${whole}.${frac.slice(0, Math.max(0, decimals))}`;
  }
  return s.replace(/^0+(?=\d)/, '').slice(0, 40);
}

/** The amount in base units, or null when the text is empty, zero or not a number. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const s = text.trim();
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  try {
    const v = parseUnits(s.endsWith('.') ? s.slice(0, -1) : s, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** A readable amount with at most `maxFraction` decimals, rounded down so it never overstates. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 6): string {
  const full = formatUnits(value, decimals);
  const [whole, frac = ''] = full.split('.');
  const wholeFmt = BigInt(whole).toLocaleString('en-US');
  // Small numbers keep enough digits to show something useful.
  let keep = maxFraction;
  if (whole === '0' && frac) {
    const lead = frac.search(/[1-9]/);
    if (lead >= maxFraction) keep = Math.min(lead + 4, decimals);
  }
  const cut = frac.slice(0, keep).replace(/0+$/, '');
  return cut ? `${wholeFmt}.${cut}` : wholeFmt;
}

/** The amount as plain text for an input field, without grouping. */
export function amountToInput(value: bigint, decimals: number): string {
  const full = formatUnits(value, decimals);
  return full.includes('.') ? full.replace(/\.?0+$/, '') : full;
}

/** Token amount to a JavaScript number, for display maths only. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}
