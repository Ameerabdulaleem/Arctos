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
| Dashboard | Market widgets, altseason index, top movers, headlines, whale feed, your wallet's tokens and NFTs | All of the above plus chain RPC, Jupiter, Magic Eden, and Alchemy when keyed |
| Trading Terminal | Real spot swaps and bridges signed in your own wallet, with a live DexScreener chart. A Practice tab keeps paper trading on live candles and order books | Relay, Jupiter, KyberSwap, 0x, Sushi, Squid, DexScreener, Binance |
| Sniper Engine | New liquidity pools on 5 chains, token search, contract risk checks | GeckoTerminal, DexScreener, GoPlus |
| Alpha | Posts on X from top traders and founders, and the coins they call, ranked by how many of them called each | TwitterAPI.io or the X API (needs a key), DexScreener |
| Whale Alerts | Smart money wallets graded by how often they bought pumping tokens early, with their holdings; large transfers on Ethereum, BNB Chain, Base, Arbitrum and Bitcoin | GeckoTerminal, chain RPC, Blockchair |
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

**Auto sniping.** Two ways to pick tokens. **Automatic filter** needs no settings: every 30 seconds it scans, on every chain you pick (Solana and BNB Chain by default, Base and Ethereum on request), the launchpad feeds, the busiest pools, DexScreener's boosted, profile and takeover lists and the tokens of the metas gaining most in the last hour, and buys the best token that has at least $20k of liquidity (or a bonding curve a quarter done), more buyers than sellers, enough trades to trust, a clean contract check (or a deep pool trading for hours), a market cap no more than 40 times its liquidity, and a pool at least 20 minutes old. It never buys a token that already pumped hard (up 20% in 5 minutes, 60% in an hour, or 400% in a day while still rising) or one that is falling (down 8% in 5 minutes or 15% in an hour), since that is how most snipes lose. Every card shows the same chasing or falling warning. **My filters** buys only launchpad tokens that pass your own filters. Each scan is logged with what was bought and why the rest were skipped. Auto sniping spends at most the budget you set (paper), or what is in the sniper wallets, buys on a chain only while its wallet is unlocked and funded (the others carry on), and holds at most 5 snipes at once.

**Sniper wallets.** For real auto sniping without a popup per trade, the sniper uses its own wallets, kept only in your browser and protected by one password: a **Solana** wallet and an **EVM** wallet, one address that works on BNB Chain, Base, Ethereum, Arbitrum and the other EVM chains. You save each wallet's key once (the Solana key imports into Phantom, the EVM key into MetaMask, Rabby or OKX), then deposit a budget: SOL from Phantom, or BNB, ETH and the rest from your EVM wallet, on whichever chains you want to snipe. On Solana the sniper trades through Jupiter; on EVM chains through the best of KyberSwap, 0x and Sushi, with every plan passing the same safety check as the Trading Terminal and approvals for the exact amount only. Keys are encrypted with PBKDF2 and AES-GCM and decrypted only in memory after you unlock; lock, or close the page, and they are forgotten. Withdrawals always go to your own connected wallet. Existing Solana sniper wallets can add the EVM wallet with the same password.

**Exit plan, results and filters** fold away behind their headers, which remember whether they are open.

**Paper account or your own wallet.** A switch at the top of the page chooses how snipes are made: Paper, Sniper wallet, or My wallet. The paper account simulates them at the live price, runs auto sniping and sells by the exit plan even while you are away. With **My wallet**, each Buy is a real swap of the amount you set per chain (for example 0.1 SOL) through the best route (Jupiter, Relay, KyberSwap and others), shown on the same review screen and checked the same way as the Trading Terminal, and signed in your wallet. Wallet snipes are listed with live profit and loss and Sell 50% and Sell all buttons. Selling needs your signature, so in wallet mode the exit plan alerts you when a target is hit while the page is open, with a one click sell, and auto sniping stays on the paper account. Arctos never holds funds or keys.

**DexScreener tab.** Alongside Just launched and Most active, the sniper lists what is trending on DexScreener: the tokens with the most boosts (paid promotion, so judged on their numbers like any other), tokens whose teams just published a profile, community takeovers, and the trending metas (narratives such as AI or cats) with the biggest tokens in each. Every token gets the contract risk check and can be paper sniped, bought from the wallet or tracked. A Live DexScreener view embeds DexScreener's own trending, top, gainers and new pairs lists. The data comes from `/api/discover`, cached for everyone for 30 seconds.

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
* Relay quotes must name your wallet as sender and the address you chose as recipient, and every step must come from your wallet. Jupiter transactions must list your wallet as a signer, and the wallet's answer must carry its signature before anything is sent.
* Jupiter's signed order lives only about a minute, so the firm price is refreshed quietly while the review is open, and fetched again at the click if it is older than 12 seconds. If the price moved against you by more than 1 percent in that time, you are asked to look again. An order that still expires while the wallet is open is reported plainly, nothing is swapped, and a fresh price is ready for the next press.
* Tokens that are not on a verified list show a contract risk check (honeypot, taxes, flags) and need a tick before the swap button works. So does a price impact worse than 15 percent.
* Slippage defaults to 0.5 percent and warns above 5 percent.
* Arctos adds no fee and never holds funds.

**Market panel.** Beside the swap panel: a search box for any token on DexScreener (by name, symbol or contract address, on every chain Arctos swaps), and three views of the chosen token. Chart is DexScreener's live chart. Info shows the token's website and social accounts (X, Telegram, Discord and others), price, liquidity, market cap and FDV, price change, volume and buys against sells over 5 minutes, 1 hour, 6 hours and 24 hours, its contract and top pool with copy buttons, and its other pools. DexScreener embeds DexScreener's own trending, top volume, gainers and new pairs lists for any chain. Search and Info call DexScreener's public API straight from the browser and keep answers for 30 to 60 seconds, so switching views is instant.

**Amounts in your currency.** The pay box has an "In $ USD" switch (or your chosen display currency), so you can type 10 dollars or 15,000 naira instead of a token amount. The token amount is worked out from DexScreener's live price and shown underneath.

**Bridge recipient.** A bridge pays out to your own connected wallet on the other chain by default, shown with its address, and connecting it takes one click. Choose "Another address" to send to someone else.

**Copy buttons.** Every token with a contract, in the swap panel, the token picker, the dashboard's wallet and NFTs, the sniper and the market panel, has a copy button beside it.

**Fast wallet prompts:** Solana swaps are signed through the Wallet Standard (Phantom, Solflare, Backpack and others register with it), which takes the transaction as bytes, so nothing heavy loads between the click and the wallet window. Phantom's older injected API remains a fallback. Relay's SDK and chain list load when the review opens, not at the click.

**Limits:** Squid deposit address routes are not run (the panel says so and you can pick another quote). Squid is used between EVM chains only; Relay covers Solana bridges. Recent swaps are remembered on your device only.

## Alpha: what top traders post on X

The Alpha page follows a list of traders and founders on X (Ansem, CZ, Elon Musk, Murad and others) and pulls the coins out of their posts: contract addresses, DexScreener and launchpad links, and $tickers. Each coin is resolved on DexScreener; a $ticker goes to its most liquid, longest running token so copycats are skipped, while a posted contract is used exactly. Coins are ranked by how many different accounts called them, then by mentions and how recent. Posts sit on the left, coins on the right with copy, explorer and DexScreener buttons. A second tab lists tokens named after a word in a post that launched after it (a coin made on something Elon said, for example).

X does not let apps read posts for free, so Alpha needs one of these keys on the server:

| Key | Where | Cost |
| --- | --- | --- |
| `TWITTERAPI_IO_KEY` (recommended) | twitterapi.io, which gives new accounts up to $1 of free credit | About $0.15 per 1,000 posts. Following 24 accounts once a minute costs roughly $0.10 to $0.20 a day |
| `X_BEARER_TOKEN` | The official X API (pay per use) | About $5 per 1,000 posts |

Set `ALPHA_ACCOUNTS` to a comma separated list of handles to change who is followed. TwitterAPI.io's free tier allows one call every five seconds, so calls are spaced 5.2 seconds apart (set `ALPHA_CALL_SPACING_MS` lower once the account has credit), and posts read before a refusal are kept. Accounts are searched in groups of six, which answer quickly, taking turns across refreshes, and each group only asks for posts newer than its last read. The service reads the last 12 hours of posts once a minute, caches the result, and lets the CDN serve it, so visitors never spend the key. Without a key the page explains how to add one.

## Smart money in Whale Alerts

The Smart money tab finds wallets that bought legit tokens before they pumped. For Solana, BNB Chain and Base it reads the trending pools on GeckoTerminal, keeps the legit ones (real liquidity and volume, not a stablecoin or wrapped coin), picks those that rose most plus a couple that did not (so losses count too), and reads every trade of $300 or more in them. Each wallet's entry price is set against today's price, with what it sold and what it still holds. Bots that trade dozens of times in a pool, or buy and sell in the same second, are left out. Trades from earlier scans are kept for three hours, so a wallet that hits several tokens rises.

Grades: **A** won on two or more tokens, three in four or better, with at least $1,000 profit and an early entry (in at under half of today's price). **B** won on two with a win rate of 60% or more, or got in early on one for double or more. **C** is in profit on at least one. Pick a wallet to see its trades in the scanned tokens, what it holds now (each token with copy, explorer, DexScreener and Swap buttons), and, for Solana, a full grade from its last 300 transactions using the Trade Book's engine. Wallets can be tracked, which highlights their large transfers in the feed. A scan costs about seven provider calls and is cached for ten minutes. GeckoTerminal's free allowance is shared with the sniper and with other sites on the same host, so when it is busy the scan waits ten seconds and asks once more, and the page tries again a minute later. A free CoinGecko demo key in `COINGECKO_API_KEY` gives Arctos its own allowance and makes scans reliable.

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
| `wallet_holdings` | What a public wallet holds: one of the user's connected wallets, or an address they give |
| `dexscreener_trends` | DexScreener's trending metas and their biggest tokens, the most boosted tokens, new token profiles and community takeovers, priced with live pool data |

**Your connected wallets.** The app tells the assistant which wallets are connected in the browser (Phantom and any EVM wallet, from the swap panel or the sign in) and what they hold, so "analyse my wallet" works without pasting an address. Only public addresses and balances are shared. Token names from wallets are cleaned and marked as data, so a scam token's name cannot pass for an instruction.

**Your trade history.** With Phantom connected, the assistant also gets the Trade Book's numbers for the wallet: totals, and per token the date of the first buy, what was put in, the average cost, what came back from sells, what is held now and its value, and the profit or loss from the first buy to now. So "what have I lost on WEN since I bought it" gets a real answer. Tokens held with no buy found in the transactions read are marked as such, so their cost is never guessed. The suggested questions under the chat can be folded away, and the choice is remembered.

**Trends.** Asked what is trending or what could make money, the assistant reads DexScreener's metas first, then the strongest narratives' tokens and the boosted list, checks contracts on anything small it picks, and ranks by evidence (rising market cap with real volume, enough liquidity to exit, more buyers than sellers). It never promises profit.

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

## Trade Book: your wallet's real profit and loss

With Phantom connected, the Trade Book reads the wallet's own trades from Solana and shows total profit, total loss, net P/L (realized and unrealized), total trades, win rate, money invested, volume and network fees, plus a table per token. Each buy is valued at what was paid at the time: SOL at Binance's price for that moment (5 minute candles for recent history, hourly for older), stablecoins at a dollar. Each sell is valued at what came back. Cost is averaged per token, and what you still hold is valued at today's price. Tokens that arrived without a trade (transfers, airdrops) have no known cost, so they are left out and counted separately.

Every wallet connected anywhere in the app shows in the Trade Book at once, with a picker when there are several. For a Solana wallet it reads the last 500 transactions first, asking again with growing pauses when the free public network refuses one (and saying how many it still could not read), and keeps going further back (up to 2,000) while a token the wallet holds has no buy found yet. Every token the wallet holds is listed, even one with no buy in the transactions read, with its value and "Cost unknown". Buys paid in wrapped SOL count as SOL. "Read older trades" goes further back still. Transactions are read from public Solana RPCs, four at a time, and kept on your device, so later visits only read what is new. The first read takes about 15 seconds for 500 transactions. For an EVM wallet it shows the wallet's value and every holding on each network (all tokens with `ALCHEMY_API_KEY`, native coins and major tokens without); profit and loss from EVM trade history is not worked out yet. The manual journal is still there below it.

## Wallet balances and NFTs

The dashboard's Wallet and NFTs tabs, and the "In your wallet" list in the swap panel, read the connected wallet:

| Wallet | Tokens | NFTs |
| --- | --- | --- |
| Solana | Every token, named, with a logo and a price from Jupiter's token list | Yes, from Magic Eden |
| EVM, without a key | Native coins and major tokens (stablecoins, wrapped ETH, BNB, BTC) on Ethereum, BNB Chain, Base and Arbitrum | No |
| EVM, with `ALCHEMY_API_KEY` | Every token, priced, on Ethereum, BNB Chain, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea and Sonic | Yes, on the chains Alchemy indexes (not BNB Chain or Sonic) |

Get a free Alchemy key at dashboard.alchemy.com and set `ALCHEMY_API_KEY` in Vercel. It stays on the server. A chain Alchemy cannot read at that moment falls back to plain RPC.

Tokens without a price (almost always airdropped spam, often using a famous name) and dust under a cent are counted, not listed; the page says how many. Exact balances are kept in the token's smallest unit, so the swap panel's Max uses all of it. NFTs have their own endpoint and a longer cache, so balances never wait for pictures.

Solana's free public RPC refuses bundled requests from busy shared servers, so every Solana call is sent on its own and falls back to a second public RPC. For heavier traffic, set `SOLANA_RPC_URL` to your own RPC (Helius and others have free plans); it is tried first.

## Display currency

Prices, balances, portfolio values, market caps and trade journal results can be shown in the visitor's own currency, such as the Nigerian naira, the euro or the Ghanaian cedi. The picker sits in the top bar and in Settings, lists 54 currencies, and suggests the one for the browser's region.

Every amount the service returns stays in US dollars; the web app only converts for display, with daily rates from `/api/fx`. The service reads them from the free currency API on jsDelivr, falls back to its mirror and then to ExchangeRate-API, keeps them for an hour (and serves the last good rates for up to two days if every source is down), and lets the CDN cache them. The choice and the last rates are remembered on the visitor's device, so the first screen already shows the right currency.

Swap amounts stay in the tokens being traded. The practice account stays in USDT, because it trades USDT pairs and its order fields are in USDT. Trade journal prices are entered in US dollars and shown in the chosen currency.

## What is simulated, and what is not covered

Be clear about these before you rely on the app:

* **Practice and sniper trades are paper trades.** Orders in the terminal's Practice tab and in the sniper are simulated against real order books and prices, with a 0.1 percent fee, limit orders, take profit and stop loss. Sniper trades are sold by the exit plan described above. Real funds only move in the Swap and bridge tab, after you review the swap and sign it in your own wallet.
* **PRE-IPO cards are static.** Private companies have no free live price feed. The listings and valuations in `src/app/data/preIpoListings.ts` are maintained by hand and are labelled as possibly out of date. Update them when you refresh the cards.
* **Solana whale alerts are not available yet.** A reliable Solana feed needs a dedicated RPC provider. The page says so.
* **Wallet coverage depends on the chain.** See [Wallet balances and NFTs](#wallet-balances-and-nfts). DeFi positions (liquidity, lending, staking) are not read.
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
| `ALCHEMY_API_KEY`, `SOLANA_RPC_URL` | Every token and NFT in EVM wallets, and your own Solana RPC. See [Wallet balances and NFTs](#wallet-balances-and-nfts). Both stay on the server. |
| `FX_SOURCES` | Optional. Comma separated exchange rate sources, tried in order. See [Display currency](#display-currency). |
| `TWITTERAPI_IO_KEY`, `X_BEARER_TOKEN`, `ALPHA_ACCOUNTS`, `ALPHA_CALL_SPACING_MS` | The Alpha page's X data source and who it follows. See [Alpha](#alpha-what-top-traders-post-on-x). Keys stay on the server. |
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
  * `ALCHEMY_API_KEY` shows every token and NFT in EVM wallets. `SOLANA_RPC_URL` points Solana reads at your own RPC.
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
cd backend && cargo test          # 127 unit tests and 27 end to end tests against a fake upstream, in both modes
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
