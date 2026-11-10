# Copilot and AI agent instructions for Arctos

Read `README.md` first. It explains the architecture, what is live and what is simulated.

## Shape of the project

- `src/app/` is the React app (Vite, TypeScript, Tailwind). Pages live in `components/`, API clients in `services/`, pure logic in `lib/`, shared state in `contexts/`.
- `backend/` is the Rust data service (Axum, Tokio). It polls the public data providers, caches, rate limits and serves REST and WebSocket to the app. It also proxies the AI assistant and stores the waitlist.
- The app never calls data providers directly. All market, chain, news, stock and AI data goes through the service in `src/app/services/api.ts`.

## Rules to keep

1. **No mock or random data in the app or the service.** If a source fails, show an error state. The only canned data lives in `scripts/dev-fixtures` and the tests.
2. **No secrets in the browser.** Never put keys in `VITE_` variables. Anything that needs a key goes through the Rust service.
3. **External text is untrusted.** Sanitise it in Rust, render it as text in React, and only open http or https links (`safeHref`).
4. **Trading is paper trading.** Do not add real order execution without a reviewed signing flow and tests.
5. **Effects must not return values.** In React effects use a block body, not an expression body, so a returned value is never treated as a cleanup function.
6. **Do not poll in a loop on failure.** Failed requests must be remembered or backed off, never retried on every render.

## Commands

```bash
npm run dev            # web app on :5173, proxies /api and /ws to :4000
npm test               # vitest unit tests
npm run lint && npm run build
cd backend && cargo run
cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Style

- Dark UI with Tailwind zinc and blue. Keep layouts responsive down to 360 px.
- Prefer small components, typed API clients, and pure functions that can be unit tested.
- In copy shown to users, write plainly and avoid hyphens and dashes where a comma works.
