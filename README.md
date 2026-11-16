# Arctos

Arctos is a crypto trading workspace that puts live market data, whale tracking, new token discovery, fundamental news, public stock quotes and an AI assistant in one place.

Everything you see on screen comes from a live source. When a source is down, Arctos says so instead of showing made up numbers.

## How it is built

```text
Browser (React + Vite)
   |  same site: /api
   v
Arctos data service (Rust, Axum + Tokio)   <-- this is where the speed comes from
   |  caches, rate limits, health checks
   v
CoinGecko, Binance, Alternative.me, DexScreener, GeckoTerminal, GoPlus, Blockchair,
public chain RPC (Ethereum, BNB Chain, Base, Arbitrum, Solana), crypto RSS feeds,
Yahoo Finance, Anthropic (AI)
```

The Rust service does all the heavy work: it fetches from the providers, shares one upstream call between many visitors, scans chains for large transfers, and serves the AI assistant so the API key never reaches the browser.

The same Rust code runs in two ways:

| | On Vercel (default) | As a standalone server |
| --- | --- | --- |
| Entry point | `api/main.rs`, a Vercel function | `backend/src/main.rs`, a long lived process |
| How data stays fresh | Each request refreshes what it needs behind short lived caches, and the CDN caches responses for a few seconds | Background pollers keep everything hot in memory |
| Live updates | The app polls every few seconds | WebSocket streams |
| Setup | None. `vercel.json` sends `/api/*` to the function | Deploy `backend/Dockerfile`, then set `VITE_RUST_BACKEND_URL` |

The web app asks `/api/status` which mode it is talking to and adapts, so nothing else changes between the two.

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

## The sniper engine

The sniper watches launchpads on 17 chains (Solana, BNB Chain, Base, Avalanche, NEAR, Robinhood Chain, Ethereum, Arbitrum, Polygon, Sui, TON, Tron, Monad, Abstract, HyperEVM, Sonic and Berachain). On Solana that includes Pump.fun, PumpSwap, LetsBonk, Raydium LaunchLab, Meteora DBC, Moonshot and more. Four.meme is covered on BNB Chain, Virtuals and Bankr on Base, The Arena on Avalanche, and Hoodit, Clanker and Virtuals on Robinhood Chain.

Every token gets a snipe score out of 100, built from live data and shown with its reasons:

| Part | Points | What it reads |
| --- | --- | --- |
| Demand | 30 | Real buy and sell counts, and how many separate wallets are buying against selling |
| Developer | 25 | The launch wallet, how much it still holds, and its record on earlier launches |
| Safety | 25 | Mint and freeze authority, honeypot flags, trade taxes, holder spread |
| Liquidity | 10 | Pool depth and age, or bonding curve progress while a token is still on its curve |
| Momentum | 10 | Recent price action and how close the token is to graduating |

A serious risk (honeypot, active mint or freeze authority, a very high tax, a developer holding a large share) blocks a token whatever else looks good. A token that has not been fully checked yet says so, stays out of the top grades, and is never bought by the auto sniper.

Three honest limits:

* **No win rate can be promised.** Most newly launched tokens lose value. The score ranks candidates. The page shows the sniper's real win rate, measured from its own closed paper snipes, so you can judge the filters on results.
* **A developer's record is built from what this service has observed.** There is no free public index of every wallet's past launches, so the record starts empty and grows as tokens are checked. It is kept in memory, so it resets when the service restarts.
* **Checks are paced.** GeckoTerminal's free tier wants calls about three seconds apart, so roughly three tokens a minute get a full check per feed. Add a free CoinGecko API key (`COINGECKO_API_KEY`) and the same data comes from a tier with its own allowance, which triples that.

### The exit plan

Every snipe is sold by one exit plan, set on the sniper page. A change to the plan also applies to snipes that are already open.

* **Take profit 1, 2 and 3.** Each target has its own profit percentage and its own share of the position to sell, for example sell 60% at +80%, 20% at +400% and 20% at +1000%. Each has a switch, so you can run one, two or all three. Whatever the targets do not sell keeps riding.
* **Stop loss.** Sells everything when the price is a set percentage below what you paid.
* **Developer exit guard.** Sells everything when the developer is seen leaving: their share of the supply has dropped by a quarter or more since you bought, or about 30% of the pool's liquidity has been withdrawn beyond what the price move explains.

The rules live in one place, the trade keeper in the data service (`backend/src/keeper.rs`). The web app reports its open snipes to the keeper every few seconds and books the sales the keeper decides on.

What the exit plan cannot do:

* **Sales are simulated at the price seen when a check runs.** Between two checks a price can jump past a target or through a stop, and the sale is booked at the price that was actually seen.
* **The guard is a set of warning signs, not a prediction.** The developer wallet is read about once a minute per token, a developer can move tokens through other wallets, and on a bonding curve there is no pool to watch. A fast rug pull can be over before any check sees it.

### Managing trades while you are away

Where a trade's progress is kept decides whether it is managed with Arctos closed:

| Setup | Managed with every tab closed? |
| --- | --- |
| Vercel with no database (the default) | No. Open snipes are managed while Arctos is open in at least one browser tab, on any page. |
| Vercel with a PostgreSQL database | Yes. The keeper stores the open snipes and a scheduled job checks them every minute or so. |
| The standalone server | Yes. It checks every 20 seconds on its own. With no database the trades are forgotten if the server restarts. |

To switch it on for a Vercel site:

1. In Vercel, open the project, go to Storage, create a Postgres database (Neon has a free tier) and connect it to the project. This adds `DATABASE_URL` for you. Pick a region close to Frankfurt, where the function runs.
2. Redeploy. `/api/status` then shows `"keeper": {"offline": true, "durable": true}`.
3. Nothing else is needed. The workflow in `.github/workflows/keeper.yml` already calls the site every five minutes and, while snipes are open, checks them about once a minute. It runs on GitHub's free scheduler, which can run late when GitHub is busy and is switched off after 60 days without a commit (re-enable it under Actions).

On Vercel's Pro plan you can use Vercel Cron instead, by adding `"crons": [{"path": "/api/sniper/keeper/tick", "schedule": "* * * * *"}]` to `vercel.json`. The Hobby plan only allows one cron run a day, which is why this is not switched on by default. Set `CRON_SECRET` in Vercel if you want the scheduled check to refuse callers that do not know it, and add the same value as a repository secret so the GitHub workflow can still call it.

The paper account stays in your browser either way. The keeper only knows a hash of a random key your browser generates, the token, the size and the plan. Sales made while you were away are booked, and shown, the next time you open Arctos on the same browser. Snipes nobody has come back to for 30 days are dropped.

## What is simulated, and what is not covered

Be clear about these before you rely on the app:

* **Trading is paper trading.** Orders in the terminal and the sniper are simulated against the real order book and real prices, with a 0.1 percent fee, limit orders, take profit and stop loss. Sniper trades are sold by the exit plan described above. No real funds move and no wallet signature is ever requested. Real execution through a DEX aggregator needs a signing flow that deserves its own careful build and testing.
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
| `VITE_RUST_BACKEND_URL` | Optional. Leave it empty to use the data API on the same site (the Vercel function). Set it only when the service is hosted somewhere else. |
| `VITE_SOCIAL_X`, `VITE_SOCIAL_TELEGRAM`, `VITE_SOCIAL_GITHUB` | Optional footer links. |

Data service (`backend/.env.example`):

| Variable | Purpose |
| --- | --- |
| `FRONTEND_ORIGINS` | Comma separated site origins allowed to call the service. Needed for a standalone server. On Vercel the site and the API share one host, which is accepted automatically. |
| `TRUST_PROXY` | `true` behind your own proxy so rate limits see the real client IP. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | AI assistant. The default model is `claude-opus-5-5`. |
| `DATABASE_URL` | PostgreSQL (optional). Gives the waitlist real positions and lets the trade keeper manage open snipes while nobody has the app open. `POSTGRES_URL` is read too. |
| `CRON_SECRET` | Optional. When set, the keeper's scheduled check only answers callers that send it as a bearer token. |
| `MAIL_*`, `PUBLIC_SITE_URL` | SMTP settings for the welcome email (optional). |
| `COINGECKO_API_KEY`, `BLOCKCHAIR_API_KEY` | Optional keys that raise provider limits. A CoinGecko key also speeds up the sniper's token checks. |
| `*_RPC_URL`, `TRACKED_SYMBOLS`, `WHALE_MIN_USD`, `STOCK_WATCHLIST`, `NEWS_FEEDS` | Optional tuning. |

Every provider base URL can also be overridden, which is how the fixtures work.

## Deploy

**Vercel (recommended).** Connect the repository to Vercel and deploy. That is all the site needs:

* Vercel builds the web app and the Rust function together. `vercel.json` sets the framework, the `/api/*` rewrite, the function region and the security headers.
* Live market data, whales, news, stocks and the sniper work with no environment variables.
* Add these in Vercel, Project Settings, Environment Variables, when you want the feature:
  * `ANTHROPIC_API_KEY` switches on the AI assistant.
  * `DATABASE_URL` gives the waitlist real positions and keeps open snipes managed while you are away (see the sniper section). `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_FROM` send the welcome email.
  * `COINGECKO_API_KEY` and `BLOCKCHAIR_API_KEY` raise provider limits.
* After a deploy, open `/api/status` on your site. It lists every provider and whether it is reachable.

The function runs in Frankfurt (`fra1` in `vercel.json`). Binance refuses requests from some regions, the United States among them, so keep the function in a region Binance serves. If the exchange is ever unreachable, prices fall back to the CoinGecko market list and the status page says so.

**Standalone server (optional).** For WebSocket streams and background polling, run `backend/Dockerfile` on any container host (Fly.io, Render, Railway, a VPS). Set `FRONTEND_ORIGINS`, `TRUST_PROXY=true` and your keys, then build the web app with `VITE_RUST_BACKEND_URL` pointing at it.

**CI.** `.github/workflows/ci.yml` runs lint, tests and the build for the web app, `cargo clippy` and `cargo test` for the service, and builds the function crate.

## Security notes

* The AI key lives only on the server. Requests are limited per client, origin checked, size capped, and the system prompt is built on the server, so the browser cannot change the assistant's rules.
* External text (headlines, token names) is sanitised on the server and rendered as plain text. Links are only opened if they are http or https.
* The waitlist sends one server templated email per new address. Clients cannot choose the subject or body, so the endpoint cannot be used as a mail relay.
* The service enforces per client rate limits, a body size limit, timeouts, strict response headers, and an origin check for costly endpoints. Only the site itself, or origins on the allow list, may call them, and other sites get no cross origin permission.
* TLS is pure Rust (rustls), so there is no system OpenSSL to keep patched.
* A failed contract risk check is shown as "no risk data", never as "safe".
* Never commit `.env` files. Rotate any key that was ever exposed, including SMTP credentials from earlier versions of this project.

## Tests

```bash
npm test                          # unit tests for the paper trading engine, exit plan, sniper filters, formatting, trade book, password hashing
npm run lint && npm run build
cd backend && cargo test          # 90 unit tests and 14 end to end tests against a fake upstream, in both modes
                                  # set KEEPER_TEST_DATABASE_URL to also run the trade keeper against a real PostgreSQL
cargo build                       # the Vercel function crate (repository root)
cd backend && cargo clippy --all-targets -- -D warnings
```

Tests use fixtures shaped like the provider responses. They prove the code handles those shapes, not that a provider is reachable from your host. For that, open Settings and look at the Data sources panel, or call `/api/status`.

## Repository layout

```text
src/app/            React app: components, services (API clients), contexts, hooks, lib (pure logic)
src/styles/         Design system: tokens and shared classes (panel, btn, field, seg, icon-tile)
api/main.rs         Vercel function: a thin adapter around the backend crate
Cargo.toml          The function crate (depends on backend/)
backend/src/        Rust service: market, binance, whales, sniper, launchpad, keeper, news, stocks, portfolio, ai, waitlist
backend/tests/      End to end tests with a fake upstream
scripts/            Dev fixtures and the browser walkthrough
.github/workflows/  CI, and the schedule that keeps open snipes managed while nobody is online
```

## Disclaimer

Arctos is early software. Nothing in it is financial advice. Crypto assets are volatile and new tokens are often scams. Risk scores are automated and can be wrong.
