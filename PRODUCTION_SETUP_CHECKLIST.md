# Production checklist

Work through this once before you point a real domain at Arctos.

## 1. Deploy on Vercel

The site and its data API deploy together. There is nothing to configure for live market data.

- [ ] Connect the repository to Vercel (or keep the existing connection) and deploy `main`.
- [ ] Open `https://<your site>/api/status` and confirm the sources show `ok: true` after you have browsed a few pages.
      If `binance` fails, check that the function region in `vercel.json` is one Binance serves.
- [ ] If two Vercel projects build this repository, delete the one you do not use so each push builds once.

## 2. Switch on the optional features

Add these in Vercel, Project Settings, Environment Variables, then redeploy.

- [ ] `ANTHROPIC_API_KEY` for the AI assistant. Optionally `ANTHROPIC_MODEL`.
- [ ] `DATABASE_URL`: the Supabase `arctos` project's **Transaction pooler** address (Connect button in Supabase, port 6543), with the database password filled in. Steps are in the README under "The hosted database". After a redeploy, `/api/status` should show `"database": {"configured": true, "connected": true}` and `"keeper": {"offline": true, "durable": true}`.
- [ ] Check that the "Trade keeper" workflow is running under Actions on GitHub. It is what checks open snipes while you are away. Optionally set `CRON_SECRET` in Vercel and as a repository secret to lock the scheduled check.
- [ ] `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` for the welcome email.
- [ ] `COINGECKO_API_KEY` (a free demo key from CoinGecko). It protects the market data from rate limits and makes the sniper check tokens about three times faster.
- [ ] `RELAY_API_KEY` (free, from dashboard.relay.link). Relay asks for a key on every quote from 2 October 2026, so this keeps Relay swaps and bridges, including Solana bridges, working.
- [ ] `ZEROX_API_KEY` (free, from dashboard.0x.org) adds 0x to the swap comparison.
- [ ] `SQUID_INTEGRATOR_ID` (request through Squid's partnership form) adds Squid bridges between EVM chains.
- [ ] After a redeploy, open `/api/swap/providers` on the site. It shows which of the three are on, never the keys.
- [ ] `ALCHEMY_API_KEY` (free, from dashboard.alchemy.com) shows every token and NFT in EVM wallets on the dashboard and in the swap panel. Solana wallets need no key.
- [ ] Optional: `SOLANA_RPC_URL` with your own Solana RPC (for example a free Helius endpoint) if Solana balances ever load slowly under heavy traffic.

## 3. Optional: a standalone server

Only needed if you want WebSocket streams and background polling.

- [ ] Build `backend/Dockerfile` and deploy it (Fly.io, Render, Railway or a VPS).
- [ ] Set `FRONTEND_ORIGINS` to your site origin and `TRUST_PROXY=true` behind a proxy.
- [ ] In Vercel, set `VITE_RUST_BACKEND_URL` to the server URL and redeploy.

## 4. Clean up from older versions

- [ ] Rotate the Brevo SMTP password and any API keys that were ever in `VITE_` variables. Those were bundled into the public site.
- [ ] Remove old Vercel environment variables such as `VITE_API_BASE`, `VITE_BREVO_*`, `VITE_ANTHROPIC_API_KEY` and `VITE_NEWS_API_KEY`.
- [ ] Review the Privacy, Terms and Risk text in `src/app/components/LegalDialog.tsx` with a lawyer.

## 5. Content you maintain by hand

- [ ] Refresh the PRE-IPO listings and valuations in `src/app/data/preIpoListings.ts`.
- [ ] Replace the placeholder referral links with your own.
