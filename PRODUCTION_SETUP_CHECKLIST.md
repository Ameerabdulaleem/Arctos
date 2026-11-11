# Production checklist

Work through this once before you point a real domain at Arctos.

## 1. Data service

- [ ] Build `backend/Dockerfile` and deploy it (Fly.io, Render, Railway or a VPS).
- [ ] Set `FRONTEND_ORIGINS` to your site origin, for example `https://arctos-fi.vercel.app`.
- [ ] Set `TRUST_PROXY=true` if the host puts a proxy in front of the service.
- [ ] Set `ANTHROPIC_API_KEY` to switch on the AI assistant. Optionally set `ANTHROPIC_MODEL`.
- [ ] Optional: `DATABASE_URL` for real waitlist positions, `MAIL_*` for the welcome email.
- [ ] Open `https://<your service>/api/status` and confirm every source shows `ok: true`.
      If `binance` fails, your host region is probably blocked. Move the service to another region.

## 2. Web app

- [ ] In Vercel, set `VITE_RUST_BACKEND_URL` to the service URL.
- [ ] Deploy, then open Settings, Data sources, and confirm the same list is healthy from the browser.

## 3. GitHub

- [ ] Add repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- [ ] Confirm the CI workflow passes on a pull request.

## 4. Clean up from older versions

- [ ] Rotate the Brevo SMTP password and any API keys that were ever in `VITE_` variables. Those were bundled into the public site.
- [ ] Remove old Vercel environment variables such as `VITE_API_BASE`, `VITE_BREVO_*`, `VITE_ANTHROPIC_API_KEY` and `VITE_NEWS_API_KEY`.
- [ ] Review the Privacy, Terms and Risk text in `src/app/components/LegalDialog.tsx` with a lawyer.

## 5. Content you maintain by hand

- [ ] Refresh the PRE-IPO listings and valuations in `src/app/data/preIpoListings.ts`.
- [ ] Replace the placeholder referral links with your own.
