Server proxy for Resend
=======================

This small Express server provides a local `/api/resend` proxy that forwards requests to the Resend API using a server-side API key. Use it during local development or deploy the route handler in `server/api/resend/route.ts` to your platform (Vercel / Netlify / Next.js) for production.

Environment
-----------
- `RESEND_API_KEY` (recommended) or `VITE_RESEND_API_KEY`
- `RESEND_FROM_EMAIL` or `VITE_RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME` or `VITE_RESEND_FROM_NAME`

Local run
---------
1. Install dependencies:

```bash
cd server
npm install
```

2. Create a `.env` in the repository root (or set env vars) containing the server `RESEND_API_KEY`.

3. Start the proxy:

```bash
npm start
```

Frontend configuration
----------------------
- Set `VITE_API_BASE` (client) to the URL of your deployed server (e.g., `https://arctos-fi.vercel.app` in production) so the frontend `resendService` prefers the server proxy. In local dev use `VITE_API_BASE=http://localhost:3001`.

CI / Automatic production deploy (Vercel)
---------------------------------------
This repo includes a GitHub Actions workflow at `.github/workflows/deploy-vercel.yml` that will:

- Deploy the repository to Vercel on pushes to `main` using a Vercel Git deployment action.
- Attempt to set the `VITE_API_BASE` environment variable on Vercel to the deployed URL using the Vercel REST API.

Required GitHub repository secrets (set in your repo settings -> Secrets):

- `VERCEL_TOKEN` — a personal token from Vercel with scope to redeploy/manage env vars
- `VERCEL_PROJECT_ID` — your Vercel project id
- `VERCEL_ORG_ID` — your Vercel organization id

Notes:
- The workflow uses the `amondawa/vercel-action` action for deployment and then calls the Vercel API to create the `VITE_API_BASE` env var. If the env var already exists, the API may create a duplicate entry; you can remove old entries from the Vercel dashboard or extend the workflow to search+patch existing env entries.
- Make sure to set `RESEND_API_KEY` (server) in Vercel's project Environment Variables (not the client `VITE_` key) so the server proxy uses the secret key in production.

