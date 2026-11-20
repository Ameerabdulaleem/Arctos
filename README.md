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
| Trading Terminal | Real spot swaps and bridges signed in your own wallet, with a live DexScreener chart. A Practice tab keeps paper trading on live candles and order books | Relay, Jupiter, KyberSwap, 0x, Sushi, Squid, DexScreener, Binance |
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
| Vercel with a PostgreSQL database | Yes. The keeper stores the open snipes and the database calls it every minute while any is open. |
| The standalone server | Yes. It checks every 20 seconds on its own. With no database the trades are forgotten if the server restarts. |

To switch it on for a Vercel site, connect the database described in [The database](#the-database) below. Nothing else is needed: once `/api/status` shows `"keeper": {"offline": true, "durable": true}`, the database itself calls the keeper every minute while any snipe is open (see `backend/migrations/supabase/scheduler.sql`).

Two backups call the same check, and the keeper makes sure only one check runs at a time whoever calls:

* The workflow in `.github/workflows/keeper.yml` calls the site every five minutes. GitHub's free scheduler can run late when GitHub is busy, and switches the workflow off after 60 days without a commit (re-enable it under Actions).
* On Vercel's Pro plan, Vercel Cron can call it too: add `"crons": [{"path": "/api/sniper/keeper/tick", "schedule": "* * * * *"}]` to `vercel.json`. The Hobby plan only allows one cron run a day.

Set `CRON_SECRET` in Vercel if you want the scheduled check to refuse callers that do not know it. Then store the same value in Supabase Vault under the name `arctos_cron_secret`, and as a repository secret for the GitHub workflow, so the schedulers can still call it.

The paper account stays in your browser either way. The keeper only knows a hash of a random key your browser generates, the token, the size and the plan. Sales made while you were away are booked, and shown, the next time you open Arctos on the same browser. Snipes nobody has come back to for 30 days are dropped.

## Swaps and bridges

The Trading Terminal opens on **Swap and bridge**: spot swaps on one chain and bridges between chains, with your own wallet signing every step. There is no margin and no perpetual trading, on purpose. The token you are buying is charted on the left with DexScreener's live chart of its deepest pool.

**Chains:** Solana, BNB Chain, Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, Linea and Sonic.

**Every route provider is asked at once, and the best output after costs wins:**

| Provider | What it does | Needs | How it is called |
| --- | --- | --- | --- |
| Relay | Swaps and bridges across EVM chains and Solana, including BNB to SOL in about a second | Optional `RELAY_API_KEY` | From the browser, or through this site's proxy when the key is set |
| Jupiter | Solana swaps (the main Solana aggregator), landed by Jupiter | Nothing | From the browser |
| KyberSwap | Same chain EVM swaps | Nothing | From the browser |
| Sushi | Same chain EVM swaps | Nothing | From the browser |
| 0x | Same chain EVM swaps | `ZEROX_API_KEY` | Through this site's proxy, which adds the key |
| Squid | Bridges between EVM chains | `SQUID_INTEGRATOR_ID` | Through this site's proxy, which adds the id |

Providers that need no key are called straight from the browser, so each visitor uses their own rate limit and the site's server is not involved. Keys never reach the browser: the proxy at `/api/relay`, `/api/zerox` and `/api/squid` adds them on the server, forwards only the paths a swap needs, follows no redirects, and is rate limited and origin checked like the rest of the API.

**Getting the keys (all free):**

* **Relay:** create an app and key at dashboard.relay.link. Relay announced that from 2 October 2026 every quote needs a key, so set `RELAY_API_KEY` to keep Relay quotes reliable. Without it the browser asks Relay directly, which works only while Relay still answers keyless requests.
* **0x:** sign up at dashboard.0x.org for a free key (about 5 requests a second, shared by everyone using the site) and set `ZEROX_API_KEY`.
* **Squid:** request an integrator id through Squid's partnership form. Squid reviews each request. Set `SQUID_INTEGRATOR_ID` once you have it.

The panel says which keyed providers are switched on. Nothing else changes.

**What protects the user before the wallet opens:**

* A firm quote is fetched for the connected wallet and shown on a review screen first: amount paid, the least that will arrive after slippage, the receiving address, the route, any approval, and any bridge fee in native coin.
* Approvals are for the exact amount of the swap, never unlimited, and only to the contract the swap then calls. For 0x only its AllowanceHolder contract is accepted, never Settler, as 0x advises.
* A plan that would send native coin on a token sale, send a different amount than you typed, run on another chain, call the token contract itself, or pay another address is refused.
* Relay quotes must name your wallet as sender and the address you chose as recipient, and every step must come from your wallet. Jupiter transactions must list your wallet as a signer.
* Tokens that are not on a verified list show a contract risk check (honeypot, taxes, flags) and need a tick before the swap button works. So does a price impact worse than 15 percent.
* Slippage defaults to 0.5 percent and warns above 5 percent.
* Arctos adds no fee and never holds funds.

**Limits:** Squid deposit address routes are not run (the panel says so and you can pick another quote). Squid is used between EVM chains only; Relay covers Solana bridges. Recent swaps are remembered on your device only.

## The AI assistant

The assistant answers from live data the service puts in its instructions (prices, the Fear and Greed index, headlines, whale transfers, and the user's paper account and trade book), and it can look up anything else in Arctos through tools:

| Tool | What it returns |
| --- | --- |
| `launchpad_feed` | Tokens on a chain's launchpads (Pump.fun and the others in the sniper), best first, each with its snipe score, age, market cap, buy share, developer record and holding, and contract risk |
| `search_tokens` | Tokens matching a name, symbol or address, with price, liquidity and volume |
| `contract_risk` | The contract risk check for one token |
| `market_overview` | Total market cap, volume, dominance, Fear and Greed with its last week, and the altcoin season index |
| `coin_lookup` | Any of the top 100 coins: rank, price, market cap, volume, 24 hour, 7 day and 30 day change |
| `price_history` | A summary of recent Binance candles for a coin: change, high, low, volume and the last closes |
| `order_book` | Best bid and ask, spread, and the money waiting on each side |
| `whale_activity` | Recent large transfers, by chain and minimum value |
| `news_search` | Recent headlines matching a keyword, with source, category and expected impact |
| `stock_quotes` | Live quotes for listed stocks |
| `wallet_holdings` | What a public wallet holds, for an address the user gives |

The service runs the tools itself (`backend/src/ai_tools.rs`) through the same functions, checks and caches as the pages: only known chains and launchpads, valid addresses and symbols, short queries. Text from outside, such as token names, is cleaned before the model sees it, and the instructions tell the model to treat tool data as data. The model may use tools for up to three rounds, and the whole answer must finish within 52 seconds.

**Running it free.** Anthropic's API needs prepaid credit. Vercel AI Gateway includes a monthly free credit for a set of models from other providers, though not for Claude, and serves them through the same request format. To use it, add a card to the Vercel team (needed to unlock the free credit), create an AI Gateway API key, and set `ANTHROPIC_API_KEY` to that key, `ANTHROPIC_BASE` to `https://ai-gateway.vercel.sh` and `ANTHROPIC_MODEL` to a free tier model such as `google/gemini-2.5-flash`. To move to Claude later, buy gateway credit and set `ANTHROPIC_MODEL` to, for example, `anthropic/claude-sonnet-5.5`.

## The database

Arctos uses one PostgreSQL database. It is optional: without it everything works, but the waitlist cannot give real positions, open snipes are managed only while the app is open, and the sniper's developer records start empty after every restart.

Everything lives in its own `arctos` schema, away from the automatic API that hosts such as Supabase put in front of `public`. Row level security is on for every table and no rule opens them, so only the data service (the table owner) can read or write. The tables:

| Table | What it holds |
| --- | --- |
| `waitlist` | Signups, one per address, stored in lower case |
| `keeper_positions`, `keeper_executions`, `keeper_meta` | Open snipes, sales waiting to be booked, and the schedule state. Owners are hashes of a random browser key, never the key |
| `token_checks` | The result of each full token check, shared by every copy of the service so a slow check is made once |
| `dev_launches` | Every launch seen from each developer wallet and how it did. This is the developer track record the sniper ranks by, and it now survives restarts |
| `schema_migrations` | Which schema versions are applied |

The view `developer_records` shows one line per developer (launches, successes, average share of buys), for reading the records by hand.

**Migrations.** The schema is in `backend/migrations/`, one numbered file per version. The service applies any it has not seen when it first reaches the database, inside one transaction under a lock, so several copies starting together are safe. Each file records its own version, so it can also be run by hand.

**Housekeeping.** Token checks are kept for 3 days and launches for 180 days. The service clears out older rows once an hour, which keeps the database far below a free plan's 500 MB.

### The hosted database (Supabase, free plan)

The live site's database is a Supabase project called `arctos`, in Frankfurt (`eu-central-1`), next to the Vercel function. It has the schema above and the scheduler from `backend/migrations/supabase/scheduler.sql`, which uses `pg_cron` and `pg_net` to call the trade keeper every minute while a snipe is open and once an hour otherwise. The hourly call also keeps the free project from being paused for inactivity.

To connect it to the site, which has to be done by someone who can see the database password:

1. In Supabase, open the `arctos` project and press **Connect** at the top.
2. Choose **Transaction pooler** (port 6543). Vercel can only reach Supabase over IPv4, and the pooler is the free way to do that. Copy the address and put the database password in place of `[YOUR-PASSWORD]`. If you do not know the password, use **Reset database password** under Project Settings, Database, and paste the new one straight in.
3. In Vercel, open the project, then Settings, Environment Variables, and add it as `DATABASE_URL` for Production.
4. Redeploy. `/api/status` should then show `"database": {"configured": true, "connected": true}`.

Every query is sent as an unnamed statement, which the pooler's transaction mode needs. A unit test fails if a query is added without that.

**Backups.** Supabase's free plan gives you no backups you can download. A daily copy to a private Railway storage bucket can be added later within Railway's free allowance.

## What is simulated, and what is not covered

Be clear about these before you rely on the app:

* **Practice and sniper trades are paper trades.** Orders in the terminal's Practice tab and in the sniper are simulated against real order books and prices, with a 0.1 percent fee, limit orders, take profit and stop loss. Sniper trades are sold by the exit plan described above. Real funds only move in the Swap and bridge tab, after you review the swap and sign it in your own wallet.
* **PRE-IPO cards are static.** Private companies have no free live price feed. The listings and valuations in `src/app/data/preIpoListings.ts` are maintained by hand and are labelled as possibly out of date. Update them when you refresh the cards.
* **Solana whale alerts are not available yet.** A reliable Solana feed needs a dedicated RPC provider. The page says so.
* **DeFi positions and NFTs are not read.** Wallet balances cover native coins and major tokens (stablecoins, wrapped ETH, BNB and BTC). Positions need an indexer.
* **Whale direction labels** only appear for a short built in list of well known exchange wallets. Everything else is shown as a plain transfer.
* **Accounts are local to the browser.** Email sign in stores a salted PBKDF2 hash on the device. There is no cloud account system yet. Connecting a wallet only reads its address; the swap panel is the one place that asks for signatures, after its review screen.

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
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_BASE` | AI assistant. The default model is `claude-opus-5-5`. See [The AI assistant](#the-ai-assistant) for running it free through Vercel AI Gateway. |
| `DATABASE_URL` | PostgreSQL (optional, see [The database](#the-database)). On Vercel use a pooler address in transaction mode, such as Supabase's on port 6543. `POSTGRES_URL` is read too. |
| `CRON_SECRET` | Optional. When set, the keeper's scheduled check only answers callers that send it as a bearer token. |
| `MAIL_*`, `PUBLIC_SITE_URL` | SMTP settings for the welcome email (optional). |
| `COINGECKO_API_KEY`, `BLOCKCHAIR_API_KEY` | Optional keys that raise provider limits. A CoinGecko key also speeds up the sniper's token checks. |
| `RELAY_API_KEY`, `ZEROX_API_KEY`, `SQUID_INTEGRATOR_ID` | Swap and bridge providers that need a key. See [Swaps and bridges](#swaps-and-bridges). They stay on the server. |
| `*_RPC_URL`, `TRACKED_SYMBOLS`, `WHALE_MIN_USD`, `STOCK_WATCHLIST`, `NEWS_FEEDS` | Optional tuning. |

Every provider base URL can also be overridden, which is how the fixtures work.

## Deploy

**Vercel (recommended).** Connect the repository to Vercel and deploy. That is all the site needs:

* Vercel builds the web app and the Rust function together. `vercel.json` sets the framework, the `/api/*` rewrite, the function region and the security headers.
* Live market data, whales, news, stocks and the sniper work with no environment variables.
* Add these in Vercel, Project Settings, Environment Variables, when you want the feature:
  * `ANTHROPIC_API_KEY` switches on the AI assistant.
  * `DATABASE_URL` connects the database (see [The database](#the-database)): real waitlist positions, open snipes managed while you are away, and developer records that survive restarts. `MAIL_USERNAME`, `MAIL_PASSWORD` and `MAIL_FROM` send the welcome email.
  * `COINGECKO_API_KEY` and `BLOCKCHAIR_API_KEY` raise provider limits.
  * `RELAY_API_KEY`, `ZEROX_API_KEY` and `SQUID_INTEGRATOR_ID` switch on the keyed swap and bridge providers.
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
* Swap transactions are checked before any wallet prompt: exact approvals only to the contract being called, no unexpected native coin, the right chain, the right sender and recipient. See [Swaps and bridges](#swaps-and-bridges). Swap provider keys never reach the browser.
* The DexScreener chart is the only page allowed in a frame (`frame-src https://dexscreener.com`), and it runs sandboxed without access to the site.
* Never commit `.env` files. Rotate any key that was ever exposed, including SMTP credentials from earlier versions of this project.

## Tests

```bash
npm test                          # unit tests for the paper trading engine, exit plan, sniper filters, formatting, trade book, password hashing
npm run lint && npm run build
cd backend && cargo test          # 93 unit tests and 16 end to end tests against a fake upstream, in both modes
                                  # set TEST_DATABASE_URL to also run the database tests against a real PostgreSQL
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
backend/src/        Rust service: market, binance, whales, sniper, launchpad, keeper, records, db, news, stocks, portfolio, ai, waitlist
backend/migrations/ Versioned database schema, and the Supabase scheduler in supabase/
backend/tests/      End to end tests with a fake upstream
scripts/            Dev fixtures and the browser walkthrough
.github/workflows/  CI, and the schedule that keeps open snipes managed while nobody is online
```

## Disclaimer

Arctos is early software. Nothing in it is financial advice. Crypto assets are volatile and new tokens are often scams. Risk scores are automated and can be wrong.
