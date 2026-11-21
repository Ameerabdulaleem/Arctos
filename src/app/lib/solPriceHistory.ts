// SOL's dollar price at past moments, from Binance candles served by the data service. Candles
// are fetched in as few windows as cover every time asked for, and kept for the session.

import { apiGet, isList } from '../services/api';
import type { Candle } from '../services/marketService';

const cache = new Map<string, Promise<Candle[]>>();

function window(interval: string, endMs: number): Promise<Candle[]> {
  const key = `${interval}:${endMs}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = apiGet<Candle[]>(`/api/market/klines?symbol=SOLUSDT&interval=${interval}&limit=1000&endTime=${endMs}`, { check: isList, timeoutMs: 15_000 });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

const STEP: Record<string, number> = { '5m': 300_000, '1h': 3_600_000, '4h': 14_400_000 };

/** A function that gives SOL's price at a time in milliseconds, or null outside the candles read. */
export async function solPriceLookup(times: number[]): Promise<(time: number) => number | null> {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return () => null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last - first;
  // Finer candles for a short history, fewer requests for a long one.
  const interval = span <= 3 * 86_400_000 ? '5m' : span <= 120 * 86_400_000 ? '1h' : '4h';
  const step = STEP[interval];
  const candles: Candle[] = [];
  let end = Math.min(Date.now(), last + step);
  for (let guard = 0; guard < 12 && end > first - step; guard++) {
    const batch = await window(interval, end - (end % 60_000));
    if (batch.length === 0) break;
    candles.push(...batch);
    end = batch[0].t * 1000 - 1;
  }
  const byTime = [...new Map(candles.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
  return (time: number) => {
    let lo = 0;
    let hi = byTime.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = byTime[mid].t * 1000;
      if (time < start) hi = mid - 1;
      else if (time >= start + step) lo = mid + 1;
      else return (byTime[mid].o + byTime[mid].c) / 2;
    }
    return null;
  };
}
