# ARCTOS

Arctos is a multi-chain trading platform interface focused on AI-assisted workflows, whale activity awareness, waitlist onboarding, and wallet-first user access.

This repository contains:
- A React + TypeScript + Vite frontend app
- Serverless API routes for waitlist and email delivery
- A Rust backend scaffold (`backend/`) for future real-time/data services

## Current Status

This is an actively evolving public build. Some modules are production-ready UI/UX, while some backend-intensive features are currently scaffolded or mocked.

## Features

- Landing/home experience with waitlist funnel
- Waitlist submission flow with email confirmation support
- Wallet connection support for:
  - MetaMask
  - Phantom
  - Rabby
  - OKX
- Application sections for:
  - Dashboard
  - Trading Terminal
  - Sniper Panel
  - Whale Alerts
  - AI Chat
  - Trade Book
  - Fundamental News
  - Settings
- Theme-aware UI (dark/light)
- Toast notifications and modal-driven onboarding

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Styling: Tailwind CSS
- Forms/validation: React Hook Form + Zod
- Charts: Recharts
- Notifications: Sonner
- Serverless API: Vercel Functions (Node.js)
- Email transport: Nodemailer (via Brevo SMTP)
- Optional backend scaffold: Rust (Axum + Tokio)

## Project Structure

```text
.
├─ src/
│  ├─ app/
│  │  ├─ components/
│  │  ├─ contexts/
│  │  └─ services/
│  ├─ styles/
│  └─ main.tsx
├─ api/
│  ├─ waitlist.js
│  └─ brevo.js
├─ backend/
│  └─ src/main.rs
└─ .github/
   ├─ workflows/
   └─ PROJECT_SPECIFICATIONS.md
```

## Local Development

### 1) Prerequisites

- Node.js 18+
- npm 9+

### 2) Install dependencies

```bash
npm install
```

### 3) Create local environment file

Create a `.env` file in the project root with placeholders like this:

```env
VITE_APP_URL=http://localhost:5173
VITE_APP_ENV=development
VITE_APP_MOCK_MODE=true
VITE_APP_WALLET_CONNECTION_MOCK=true
VITE_API_BASE=

# Brevo / SMTP (set real values only in hosting provider for production)
BREVO_SMTP_LOGIN=your-smtp-login@smtp-brevo.com
BREVO_SMTP_PASSWORD=your-smtp-password
BREVO_FROM_EMAIL=your-verified-sender@example.com
BREVO_FROM_NAME=ARCTOS Team
BREVO_HOST=smtp-relay.brevo.com
BREVO_PORT=587

# Backward-compat variables accepted by the current serverless handler:
# VITE_BREVO_SMTP_LOGIN=
# VITE_BREVO_SMTP_PASSWORD=
# VITE_BREVO_FROM_EMAIL=
# VITE_BREVO_FROM_NAME=
# VITE_BREVO_HOST=
# VITE_BREVO_PORT=
```

### 4) Run the app

```bash
npm run dev
```

App default URL: `http://localhost:5173`

## Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — type-check + production build
- `npm run preview` — preview built app locally
- `npm run lint` — run ESLint

## API Routes

### `POST /api/waitlist`

Stateless waitlist endpoint that validates an email and returns success for frontend flow control.

### `POST /api/brevo`

Sends onboarding/welcome emails using SMTP credentials from environment variables.

## Environment Variables

### Frontend

- `VITE_APP_URL`
- `VITE_APP_ENV`
- `VITE_APP_MOCK_MODE`
- `VITE_APP_WALLET_CONNECTION_MOCK`
- `VITE_API_BASE`

### Serverless email (`api/brevo.js`)

Preferred variable names:
- `BREVO_SMTP_LOGIN`
- `BREVO_SMTP_PASSWORD`
- `BREVO_FROM_EMAIL`
- `BREVO_FROM_NAME`
- `BREVO_HOST`
- `BREVO_PORT`
- `BREVO_REPLY_TO` (optional)

Backward compatibility currently exists for matching `VITE_BREVO_*` names to avoid breaking existing Vercel setups.

## Security Notes (Important)

- Never commit real credentials to git
- Keep `.env` local only
- Store production secrets in Vercel environment variables
- Rotate SMTP/API credentials immediately if they were ever exposed

Repository ignore rules already cover `.env*` while allowing `.env.example`.

## Deployment

The project is configured for Vercel:
- Build command: `npm run build`
- Output directory: `dist`

A GitHub Actions workflow exists at `.github/workflows/deploy-vercel.yml` to deploy on `main` and update `VITE_API_BASE` in Vercel.

## Rust Backend Scaffold (Optional)

The `backend/` directory contains an Axum/Tokio starter service (`http://127.0.0.1:4000`) intended for future data, websocket, and chain integrations.

Run locally:

```bash
cd backend
cargo build
cargo run
```

## Key Docs

- Product and implementation roadmap: `.github/PROJECT_SPECIFICATIONS.md`
- Rust dependency notes: `.github/RUST_DEPENDENCIES.md`
- Production deployment checklist: `PRODUCTION_SETUP_CHECKLIST.md`
- Email diagnostics: `EMAIL_DELIVERY_DIAGNOSTIC.md`

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run lint/build before opening a PR
4. Keep secrets out of commits

## Disclaimer

Arctos is under active development. Nothing in this repository is financial advice.
