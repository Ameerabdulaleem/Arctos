import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UNEXPECTED_ANSWER, apiGet, both, isList, withFields, withLists } from './api';

function answer(status: number, body: string, type = 'application/json') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));
}

afterEach(() => vi.unstubAllGlobals());

describe('apiGet', () => {
  it('returns an answer that has the expected shape', async () => {
    answer(200, '{"tickers":[{"symbol":"BTC"}],"source":"rest"}');
    await expect(apiGet('/api/market/tickers', { check: withLists('tickers') })).resolves.toEqual({ tickers: [{ symbol: 'BTC' }], source: 'rest' });
  });

  it('turns an answer of the wrong shape into an error instead of handing it to a page', async () => {
    for (const body of ['{}', '[]', 'null', '"text"', '{"tickers":"nope"}']) {
      answer(200, body);
      await expect(apiGet('/api/market/tickers', { check: withLists('tickers') })).rejects.toThrow(UNEXPECTED_ANSWER);
    }
  });

  it('treats a page of HTML as unreadable, not as data', async () => {
    answer(200, '<!doctype html><p>app</p>', 'text/html');
    await expect(apiGet('/api/status')).rejects.toThrow(UNEXPECTED_ANSWER);
  });

  it('reports an error message even when the status says success', async () => {
    answer(200, '{"error":"Service paused"}');
    await expect(apiGet('/api/news')).rejects.toThrow('Service paused');
  });

  it('keeps the service message for a failed status, and a plain one for a removed deployment', async () => {
    answer(429, '{"error":"Too many requests. Please slow down and try again shortly."}');
    await expect(apiGet('/api/news')).rejects.toThrow('Too many requests');
    answer(410, 'The deployment has been removed', 'text/plain');
    const error = await apiGet('/api/news').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(410);
  });
});

describe('checks', () => {
  it('describe shapes precisely', () => {
    expect(isList([])).toBe(true);
    expect(isList({})).toBe(false);
    expect(withFields('global', 'fearGreed')({ global: null, fearGreed: null })).toBe(true);
    expect(withFields('global')({})).toBe(false);
    expect(withLists('a', 'b')({ a: [], b: [] })).toBe(true);
    expect(withLists('a', 'b')({ a: [], b: null })).toBe(false);
    expect(withLists('a')([])).toBe(false);
    expect(both(withLists('events'), withFields('stats'))({ events: [], stats: {} })).toBe(true);
    expect(both(withLists('events'), withFields('stats'))({ events: [] })).toBe(false);
  });
});
