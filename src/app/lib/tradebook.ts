// Trade book storage shared by the Trade Book page and the AI assistant.

export interface TradeRecord {
  id: string;
  tokenName: string;
  priceBought: string;
  amount: string;
  priceSold: string;
  profitLoss: number;
  date: string;
}

export const TRADEBOOK_KEY = 'arctos_tradebook';

const isFiniteString = (v: unknown): v is string => typeof v === 'string' && v.length < 40 && Number.isFinite(Number(v));

/** Reads trades defensively: anything malformed in storage is dropped rather than crashing the page. */
export function parseTrades(raw: unknown): TradeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    if (
      typeof t.id !== 'string' || typeof t.tokenName !== 'string' || !isFiniteString(t.priceBought) ||
      !isFiniteString(t.amount) || !isFiniteString(t.priceSold) || typeof t.date !== 'string' ||
      Number.isNaN(Date.parse(t.date))
    ) continue;
    out.push({
      id: t.id.slice(0, 64),
      tokenName: t.tokenName.slice(0, 40),
      priceBought: t.priceBought,
      amount: t.amount,
      priceSold: t.priceSold,
      profitLoss: typeof t.profitLoss === 'number' && Number.isFinite(t.profitLoss) ? t.profitLoss : 0,
      date: t.date,
    });
  }
  return out;
}

export function readTrades(): TradeRecord[] {
  try {
    const raw = localStorage.getItem(TRADEBOOK_KEY);
    return raw ? parseTrades(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function isOpenTrade(t: Pick<TradeRecord, 'priceSold'>): boolean {
  const sold = parseFloat(t.priceSold);
  return !sold || sold === 0;
}

export function tradeProfit(bought: string, sold: string, amount: string): number {
  const b = parseFloat(bought);
  const s = parseFloat(sold || '0');
  const a = parseFloat(amount);
  if (!b || !a || Number.isNaN(b) || Number.isNaN(a) || Number.isNaN(s)) return 0;
  return s * a - b * a;
}

export function csvEscape(value: string): string {
  // Neutralise spreadsheet formulas that start with = + - @ so exported files cannot run code.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function tradesToCsv(trades: TradeRecord[]): string {
  const header = ['Token', 'Price bought', 'Amount', 'Price sold', 'Profit or loss', 'Date'];
  const rows = trades.map((t) => [t.tokenName, t.priceBought, t.amount, t.priceSold, String(t.profitLoss), t.date].map(csvEscape).join(','));
  return [header.join(','), ...rows].join('\n');
}
