// Test tooling only. Serves canned responses shaped like the real provider APIs so the whole stack
// can be exercised offline (CI, sandboxes with blocked egress). Nothing here ships with the website.
// Run:  node scripts/dev-fixtures/server.mjs   then start the Rust service with the env from README.

import http from 'node:http';

const PORT = Number(process.env.FIXTURE_PORT || 4999);
const now = () => Date.now();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const PRICES = { BTC: 97234.5, ETH: 3412.1, BNB: 612.4, SOL: 187.3, XRP: 2.31, DOGE: 0.381, ADA: 0.92, AVAX: 38.4, LINK: 18.7, ARB: 0.74, TON: 5.4, TRX: 0.24, DOT: 7.1, LTC: 104.2, NEAR: 5.6, SUI: 3.9 };
const CHANGE = { BTC: 1.84, ETH: -0.62, BNB: 0.41, SOL: 4.27 };

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const coins = Object.entries({ bitcoin: 'BTC', ethereum: 'ETH', tether: 'USDT', binancecoin: 'BNB', solana: 'SOL', ripple: 'XRP', 'usd-coin': 'USDC', dogecoin: 'DOGE', cardano: 'ADA', tron: 'TRX' }).map(([id, sym], i) => {
  const price = PRICES[sym] ?? 1;
  const spark = Array.from({ length: 168 }, (_, k) => price * (1 + Math.sin(k / 14 + i) * 0.03 + (rnd() - 0.5) * 0.01));
  return {
    id, symbol: sym.toLowerCase(), name: id[0].toUpperCase() + id.slice(1), image: null, current_price: price,
    market_cap: price * (1e9 / (i + 1)) * 10, market_cap_rank: i + 1, total_volume: price * 4e7, high_24h: price * 1.02, low_24h: price * 0.98,
    price_change_percentage_24h_in_currency: (CHANGE[sym] ?? (rnd() - 0.4) * 6), price_change_percentage_7d_in_currency: (rnd() - 0.4) * 12,
    price_change_percentage_30d_in_currency: id === 'bitcoin' ? 8 : (i % 2 ? 14 : -3), sparkline_in_7d: { price: spark },
  };
});
for (let i = 0; i < 40; i++) coins.push({ ...coins[3], id: `alt${i}`, symbol: `alt${i}`, name: `Alt ${i}`, market_cap_rank: 11 + i, price_change_percentage_30d_in_currency: i % 3 ? 20 : -5 });

const klines = (symbol, interval, limit) => {
  const base = PRICES[symbol.replace('USDT', '')] ?? 10;
  const step = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] * 1000;
  const end = Math.floor(now() / step) * step;
  let price = base * 0.97;
  return Array.from({ length: limit }, (_, i) => {
    const open = price;
    price = open * (1 + (rnd() - 0.47) * 0.006);
    const high = Math.max(open, price) * (1 + rnd() * 0.002);
    const low = Math.min(open, price) * (1 - rnd() * 0.002);
    return [end - (limit - 1 - i) * step, String(open), String(high), String(low), String(price), String(10 + rnd() * 90), 0, '0', 1, '0', '0', '0'];
  });
};

let block = 4096;
const rss = () => {
  const items = [
    ['SEC approves new spot Ethereum ETF options trading', 'https://example.com/news/1', 12, 'Regulators signed off on the long awaited product this morning.'],
    ['Bitcoin ETF inflows hit a record as institutions pile in', 'https://example.com/news/2', 40, 'Spot products attracted the largest daily inflow since launch.'],
    ['Solana network upgrade goes live with faster block times', 'https://example.com/news/3', 95, 'Validators completed the rollout without downtime.'],
    ['DeFi lending protocol drained in a $12M exploit', 'https://example.com/news/4', 150, 'Attackers abused a pricing oracle and moved funds through mixers.'],
    ['Stablecoin supply reaches a new high', 'https://example.com/news/5', 400, 'USDT and USDC growth lifted aggregate market capitalization.'],
  ];
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title>${items.map(([t, l, m, d]) => `<item><title>${t}</title><link>${l}</link><description><![CDATA[<p>${d}</p>]]></description><pubDate>${new Date(now() - m * 60000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
};

const tokAddr = (net, i) => (net === 'solana' ? String.fromCharCode(65 + i).repeat(44) : `0x${String(i + 1).repeat(40)}`);
const pool = (net, i, sym) => ({
  id: `${net}_pool${i}`, type: 'pool',
  attributes: { name: `${sym} / WETH`, address: `0xpool${i}`, base_token_price_usd: String(0.0004 * (i + 1)), pool_created_at: new Date(now() - (i + 1) * 420000).toISOString(),
    fdv_usd: String(150000 * (i + 1)), market_cap_usd: null, price_change_percentage: { m5: String(i), h1: '3.1', h24: String(40 - i * 9) }, transactions: { h24: { buys: 40 + i, sells: 22 } },
    volume_usd: { h24: String(18000 * (i + 1)) }, reserve_in_usd: String(32000 * (i + 1)) },
  relationships: { base_token: { data: { id: `${net}_${tokAddr(net, i)}`, type: 'token' } }, dex: { data: { id: 'uniswap_v3' } } },
});

const dexPair = (chainId, addr, sym, liq) => ({
  chainId, dexId: 'uniswap', url: `https://dexscreener.com/${chainId}/${addr}`, pairAddress: addr, baseToken: { address: addr, name: `${sym} Token`, symbol: sym },
  priceUsd: '0.0123', txns: { h24: { buys: 120, sells: 88 } }, volume: { h24: 250000 }, priceChange: { m5: 0.4, h1: 1.2, h24: 9.8 }, liquidity: { usd: liq }, fdv: 4200000, pairCreatedAt: now() - 3600000,
});

const rpcHandle = (req) => {
  const { id, method, params } = req;
  let result;
  switch (method) {
    case 'eth_blockNumber': block += 1; result = '0x' + block.toString(16); break;
    case 'eth_getBlockByNumber': result = { number: params[0], timestamp: '0x' + Math.floor(now() / 1000).toString(16),
      transactions: params[1] ? [{ hash: '0x' + block.toString(16).padStart(64, 'a'), from: '0x28c6c06298d514db089934071355e5743bf21d60', to: '0x1111111111111111111111111111111111111111', value: '0x' + (250n * 10n ** 18n).toString(16), input: '0x' }] : [] }; break;
    case 'eth_getLogs': result = [{ address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', blockNumber: '0x' + block.toString(16), transactionHash: '0x' + block.toString(16).padStart(64, 'b'), logIndex: '0x1',
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x000000000000000000000000' + '71660c4005ba85c37ccec55d0c4493e66fe775d3', '0x000000000000000000000000' + '2222222222222222222222222222222222222222'],
      data: '0x' + (3_400_000n * 10n ** 6n).toString(16).padStart(64, '0') }]; break;
    case 'eth_getBalance': result = '0x' + (2_500_000_000_000_000_000n).toString(16); break;
    case 'eth_call': result = '0x' + (12_345_670_000n).toString(16).padStart(64, '0'); break;
    case 'getBalance': result = { value: 12_500_000_000 }; break;
    case 'getTokenAccountsByOwner': result = { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: 840.5 } } } } } }] }; break;
    default: result = null;
  }
  return { jsonrpc: '2.0', id, result };
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const readBody = () => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

  if (p === '/cg/global') return json(res, { data: { active_cryptocurrencies: 17432, total_market_cap: { usd: 3.42e12 }, total_volume: { usd: 1.18e11 }, market_cap_percentage: { btc: 58.2, eth: 11.9, usdt: 4.8, bnb: 3.4, sol: 2.9, xrp: 2.6 }, market_cap_change_percentage_24h_usd: 1.37 } });
  if (p === '/cg/coins/markets') return json(res, coins);
  if (p === '/fng/') return json(res, { data: Array.from({ length: 30 }, (_, i) => ({ value: String(55 + Math.round(Math.sin(i / 4) * 15)), value_classification: i === 0 ? 'Greed' : 'Neutral', timestamp: String(Math.floor(now() / 1000) - i * 86400) })) });
  if (p === '/api/v3/ticker/24hr') {
    const syms = JSON.parse(url.searchParams.get('symbols') || '[]');
    return json(res, syms.map((s) => { const b = s.replace('USDT', ''); const pr = PRICES[b] ?? 10; const ch = CHANGE[b] ?? 0.8; return { symbol: s, lastPrice: String(pr), openPrice: String(pr / (1 + ch / 100)), highPrice: String(pr * 1.02), lowPrice: String(pr * 0.97), priceChangePercent: String(ch), volume: '18234.5', quoteVolume: String(pr * 18234.5) }; }));
  }
  if (p === '/api/v3/klines') return json(res, klines(url.searchParams.get('symbol') || 'BTCUSDT', url.searchParams.get('interval') || '15m', Number(url.searchParams.get('limit') || 300)));
  if (p === '/api/v3/depth') { const pr = PRICES[(url.searchParams.get('symbol') || 'BTCUSDT').replace('USDT', '')] ?? 10; return json(res, { lastUpdateId: 1, bids: Array.from({ length: 20 }, (_, i) => [String(pr * (1 - 0.0002 * (i + 1))), String(0.3 + rnd() * 2)]), asks: Array.from({ length: 20 }, (_, i) => [String(pr * (1 + 0.0002 * (i + 1))), String(0.3 + rnd() * 2)]) }); }
  if (p === '/api/v3/trades') { const pr = PRICES[(url.searchParams.get('symbol') || 'BTCUSDT').replace('USDT', '')] ?? 10; return json(res, Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, price: String(pr * (1 + (rnd() - 0.5) * 0.0004)), qty: String(0.01 + rnd()), time: now() - (30 - i) * 900, isBuyerMaker: rnd() > 0.5 }))); }
  if (p === '/rss') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end(rss()); }
  if (p.startsWith('/yahoo/v8/finance/chart/')) { const sym = p.split('/').pop(); const prev = 100 + sym.length * 17; return json(res, { chart: { result: [{ meta: { symbol: sym, currency: 'USD', exchangeName: 'NMS', longName: `${sym} Corporation`, regularMarketPrice: prev * 1.021, chartPreviousClose: prev, regularMarketTime: Math.floor(now() / 1000) }, indicators: { quote: [{ close: Array.from({ length: 60 }, (_, i) => prev * (1 + (i / 60) * 0.021 + (rnd() - 0.5) * 0.004)) }] } }], error: null } }); }
  if (/^\/gt\/networks\/[^/]+\/new_pools$/.test(p)) { const net = p.split('/')[3]; return json(res, { data: ['PEPEX', 'MOONI', 'WAGMI', 'SNIPE'].map((s, i) => pool(net, i, s)), included: ['PEPEX', 'MOONI', 'WAGMI', 'SNIPE'].map((s, i) => ({ id: `${net}_${tokAddr(net, i)}`, type: 'token', attributes: { address: tokAddr(net, i), name: `${s} Coin`, symbol: s, image_url: null } })) }); }
  if (p === '/dex/latest/dex/search') return json(res, { pairs: [dexPair('ethereum', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 'PEPE', 91000000), dexPair('solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK', 12000000)] });
  if (p.startsWith('/dex/latest/dex/tokens/')) { const addrs = p.split('/').pop().split(','); return json(res, { pairs: addrs.map((a) => dexPair(a.startsWith('0x') ? 'ethereum' : 'solana', a, 'TRK', 500000)) }); }
  if (p.startsWith('/goplus/token_security/') || p === '/goplus/solana/token_security') {
    const addr = url.searchParams.get('contract_addresses') || '';
    const risky = addr.startsWith('0x2');
    return json(res, { code: 1, message: 'OK', result: { [addr.toLowerCase()]: p.includes('solana') ? { mintable: { status: '0' }, freezable: { status: '0' }, holder_count: '4200' } : { is_honeypot: risky ? '1' : '0', buy_tax: risky ? '0.6' : '0.01', sell_tax: risky ? '0.9' : '0.01', is_open_source: '1', is_mintable: '0', holder_count: '2300' } } });
  }
  if (p === '/anthropic/v1/messages' && req.method === 'POST') return readBody().then((b) => { const body = JSON.parse(b); const last = body.messages.at(-1).content; json(res, { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: `**Fixture reply.** You asked: "${last.slice(0, 60)}".\n\n- The system prompt carried ${body.system.length} characters of live context.\n- Bitcoin appears in it: ${body.system.includes('BTC $97')}` }] }); });
  if (p === '/rpc' && req.method === 'POST') return readBody().then((b) => { const j = JSON.parse(b); json(res, Array.isArray(j) ? j.map(rpcHandle) : rpcHandle(j)); });
  if (p === '/blockchair/bitcoin/transactions') return json(res, { data: [0, 1, 2].map((i) => ({ block_id: i === 0 ? -1 : 900000 + i, hash: `${i}`.repeat(64), time: new Date(now() - i * 600000).toISOString().replace('T', ' ').slice(0, 19), output_total: (1500 + i * 700) * 1e8 / 10, output_total_usd: (1500 + i * 700) * 9723 })) });
  json(res, { error: 'not found in fixtures', path: p }, 404);
}).listen(PORT, '127.0.0.1', () => console.log(`fixture upstream on http://127.0.0.1:${PORT}`));
