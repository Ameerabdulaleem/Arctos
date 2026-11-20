import { describe, expect, it } from 'vitest';
import { amountToInput, cleanAmountInput, formatAmount, parseAmount } from './amount';

describe('amounts', () => {
  it('cleans what the user types', () => {
    expect(cleanAmountInput('1,5', 18)).toBe('1.5');
    expect(cleanAmountInput('.25', 6)).toBe('0.25');
    expect(cleanAmountInput('1.2.3', 6)).toBe('1.23');
    expect(cleanAmountInput('0.1234567', 6)).toBe('0.123456');
    expect(cleanAmountInput('00012', 6)).toBe('12');
    expect(cleanAmountInput('12abc', 6)).toBe('12');
    expect(cleanAmountInput('5.', 6)).toBe('5.');
  });

  it('parses exactly, without floating point', () => {
    expect(parseAmount('0.1', 18)).toBe(100_000_000_000_000_000n);
    expect(parseAmount('123456789.123456789', 18)).toBe(123456789123456789000000000n);
    expect(parseAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseAmount('5.', 9)).toBe(5_000_000_000n);
    expect(parseAmount('0', 18)).toBeNull();
    expect(parseAmount('', 18)).toBeNull();
    expect(parseAmount('-1', 18)).toBeNull();
    expect(parseAmount('1e18', 18)).toBeNull();
  });

  it('formats without overstating', () => {
    expect(formatAmount(1_999_999_999n, 9, 2)).toBe('1.99');
    expect(formatAmount(1_234_567_000_000n, 6)).toBe('1,234,567');
    expect(formatAmount(1_000n, 18)).toBe('0.000000000000001');
    expect(formatAmount(5_741_247_686_892_992_865n, 18)).toBe('5.741247');
    expect(amountToInput(1_500_000n, 6)).toBe('1.5');
    expect(amountToInput(2_000_000n, 6)).toBe('2');
  });
});
