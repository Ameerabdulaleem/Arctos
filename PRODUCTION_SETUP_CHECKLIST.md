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
- [ ] `DATABASE_URL` for real waitlist positions.
- [ ] `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` for the welcome email.
- [ ] `COINGECKO_API_KEY` if CoinGecko starts limiting requests.

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
