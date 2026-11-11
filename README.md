# Arctos

Arctos is a crypto trading workspace that puts live market data, whale tracking, new token discovery, fundamental news, public stock quotes and an AI assistant in one place.

Everything you see on screen comes from a live source. When a source is down, Arctos says so instead of showing made up numbers.

## How it is built

```text
Browser (React + Vite, hosted on Vercel)
   |  REST and WebSocket
   v
Arctos data service (Rust, Axum + Tokio)   <-- this is where the speed comes from
   |  keeps everything hot in memory, caches, rate limits, health checks
   v
CoinGecko, Binance, Alternative.me, DexScreener, GeckoTerminal, GoPlus, Blockchair,
public chain RPC (Ethereum, BNB Chain, Base, Arbitrum, Solana), crypto RSS feeds,
Yahoo Finance, Anthropic (AI)
```

The Rust service does all the heavy work: it polls providers on a schedule, shares one upstream call between many visitors, relays the live price stream over a WebSocket, scans chains for large transfers, and serves the AI assistant so the API key never reaches the browser.

## What is live

| Page | Data | Source |
| --- | --- | --- |
| Homepage | Prices, market cap, volume, dominance, Fear and Greed | Binance stream, CoinGecko, Alternative.me |
| Dashboard | Market widgets, altseason index, top movers, headlines, whale feed, wallet balances | All of the above plus chain RPC |
| Trading Terminal | Candles, order book, recent trades, live prices | Binance (public market data) |
| Sniper Engine | New liquidity pools on 5 chains, token search, contract risk checks | GeckoTerminal, DexScreener, GoPlus |
| Whale Alerts | Large transfers on Ethereum, BNB Chain, Base, Arbitrum and Bitcoin | Chain RPC, Blockchair |
| Fundamental News | Headlines scored by impact | 8 crypto RSS feeds |
| Stocks & PRE-IPO | Public stock quotes | Yahoo Finance |
| AI Chat | Answers grounded in the live data above and your own portfolio | Anthropic API, called by the server |

Two numbers are computed by the service from real coin data, not copied from somewhere: the **altseason index** (share of the top 50 coins that beat Bitcoin over 30 days) and the **market cap trend** (top 10 coins over 7 days).

## What is simulated, and what is not covered

Be clear about these before you rely on the app:

* **Trading is paper trading.** Orders in the terminal and the sniper are simulated against the real order book and real prices, with a 0.1 percent fee, limit orders, take profit and stop loss. No real funds move and no wallet signature is ever requested. Real execution through a DEX aggregator needs a signing flow that deserves its own careful build and testing.
* **PRE-IPO cards are static.** Private companies have no free live price feed. The listings and valuations in `src/app/data/preIpoListings.ts` are maintained by hand and are labelled as possibly out of date. Update them when you refresh the cards.
* **Solana whale alerts are not available yet.** A reliable Solana feed needs a dedicated RPC provider. The page says so.
* **DeFi positions and NFTs are not read.** Wallet balances cover native coins and major tokens (stablecoins, wrapped ETH, BNB and BTC). Positions need an indexer.
* **Whale direction labels** only appear for a short built in list of well known exchange wallets. Everything else is shown as a plain transfer.
* **Accounts are local to the browser.** Email sign in stores a salted PBKDF2 hash on the device. There is no cloud account system yet. Wallet connection is read only.

## Run it locally

You need Node 22 and Rust (stable).

```bash
# 1. The data service (port 4000). Copy backend/.env.example to backend/.env first if you want AI, email or a database.
cd backend
cargo run
```

```bash
# 2. The web app (port 5173). Vite proxies /api and /ws to the service.
npm install
npm run dev
```

Open http://localhost:5173. Add `ANTHROPIC_API_KEY` to `backend/.env` to switch on the AI assistant.

### Running without internet access to the providers

Some networks block the public APIs. `scripts/dev-fixtures` serves canned responses shaped like the real ones, so you can run and test the whole stack offline. This is test tooling only and is never part of the site.

```bash
npm run fixtures                          # fake upstream on :4999
./scripts/dev-fixtures/run-backend.sh     # Rust service pointed at it
npm run dev                               # web app
npm run e2e                               # optional browser walkthrough, needs Playwright
```

## Configuration

Web app (`.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_RUST_BACKEND_URL` | Public URL of the deployed data service. Required for production builds. |
| `VITE_SOCIAL_X`, `VITE_SOCIAL_TELEGRAM`, `VITE_SOCIAL_GITHUB` | Optional footer links. |

Data service (`backend/.env.example`):

| Variable | Purpose |
| --- | --- |
| `FRONTEND_ORIGINS` | Comma separated site origins allowed to call the service. Set this in production. |
| `TRUST_PROXY` | `true` behind your own proxy so rate limits see the real client IP. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | AI assistant. The default model is `claude-opus-5-5`. |
| `DATABASE_URL` | PostgreSQL for real waitlist positions (optional). |
| `MAIL_*`, `PUBLIC_SITE_URL` | SMTP settings for the welcome email (optional). |
| `COINGECKO_API_KEY`, `BLOCKCHAIR_API_KEY` | Optional keys that raise provider limits. |
| `*_RPC_URL`, `TRACKED_SYMBOLS`, `WHALE_MIN_USD`, `STOCK_WATCHLIST`, `NEWS_FEEDS` | Optional tuning. |

Every provider base URL can also be overridden, which is how the fixtures work.

## Deploy

1. **Data service.** Build and run `backend/Dockerfile` on any container host (Fly.io, Render, Railway, a VPS). Set `FRONTEND_ORIGINS`, `TRUST_PROXY=true`, and your keys. Check `GET /api/status` after it starts; it lists every provider and whether it is reachable from that host.
2. **Web app.** Deploy to Vercel with `VITE_RUST_BACKEND_URL` set to the service URL. `vercel.json` already adds a strict Content Security Policy and the other security headers.
3. **CI.** `.github/workflows/ci.yml` runs lint, tests, the build and `cargo clippy` on every push. `deploy-vercel.yml` deploys `main` with the official Vercel CLI and needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets.

Some hosting regions are blocked by Binance. The service tries `data-api.binance.vision` first and `api.binance.com` second. If both are refused from your region, `/api/status` shows it and you can host the service somewhere else.

## Security notes

* The AI key lives only on the server. Requests are limited per client, origin checked, size capped, and the system prompt is built on the server, so the browser cannot change the assistant's rules.
* External text (headlines, token names) is sanitised on the server and rendered as plain text. Links are only opened if they are http or https.
* The waitlist sends one server templated email per new address. Clients cannot choose the subject or body, so the endpoint cannot be used as a mail relay.
* The service enforces per client rate limits, a body size limit, timeouts, strict response headers, and an origin allow list for costly endpoints.
* A failed contract risk check is shown as "no risk data", never as "safe".
* Never commit `.env` files. Rotate any key that was ever exposed, including SMTP credentials from earlier versions of this project.

## Tests

```bash
npm test                          # unit tests for the paper trading engine, formatting, trade book, password hashing
npm run lint && npm run build
cd backend && cargo test          # 46 unit tests and 5 end to end tests against a fake upstream
cd backend && cargo clippy --all-targets -- -D warnings
```

Tests use fixtures shaped like the provider responses. They prove the code handles those shapes, not that a provider is reachable from your host. For that, open Settings and look at the Data sources panel, or call `/api/status`.

## Repository layout

```text
src/app/            React app: components, services (API clients), contexts, hooks, lib (pure logic)
backend/src/        Rust service: market, binance, whales, sniper, news, stocks, portfolio, ai, waitlist
backend/tests/      End to end test with a fake upstream
scripts/            Dev fixtures and the browser walkthrough
.github/workflows/  CI and deploy
```

## Disclaimer

Arctos is early software. Nothing in it is financial advice. Crypto assets are volatile and new tokens are often scams. Risk scores are automated and can be wrong.
