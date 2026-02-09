# Copilot / AI Agent Instructions for Arctos

This file gives concise, actionable guidance for AI coding agents working in this repository.

1. Project overview
- Frontend SPA built with React + TypeScript on Vite. Entry: [src/main.tsx](src/main.tsx#L1-L20) which mounts [src/app/App.tsx](src/app/App.tsx#L1-L40).
- UI components live under [src/app/components](src/app/components) (use `@components` alias).

2. Build / dev / lint commands
- Start dev server: `npm run dev` (runs `vite`).
- Production build: `npm run build` (runs `tsc -b && vite build`).
- Preview build: `npm run preview`.
- Lint: `npm run lint` (uses ESLint config in repo root).

3. Important config & aliases
- Vite aliases: `@` => `src/`, `@components` => `src/app/components` (see [vite.config.ts](vite.config.ts#L1-L40)).
- TypeScript paths mirror aliases in [tsconfig.json](tsconfig.json#L1-L40).

4. Auth & wallet patterns (critical)
- Auth context: [src/app/contexts/AuthContext.tsx](src/app/contexts/AuthContext.tsx#L1-L200)
  - User session persisted to `localStorage` under key `arctos_user`.
  - Email mock accounts stored under `arctos_accounts` in `localStorage` during dev.
  - Dev mock mode toggled by env `VITE_APP_MOCK_MODE` (string `'true'`).
- Wallet connections: [src/app/services/walletService.ts](src/app/services/walletService.ts#L1-L200)
  - Supports MetaMask, Phantom, Rabby, OKX; checks `window.ethereum`, `window.phantom`, `window.okxwallet`.
  - Wallet mock mode is `VITE_APP_WALLET_CONNECTION_MOCK`.
  - Example usage: call `walletService.connectMetaMask()` or use `useAuth().connectWallet('metamask')`.

5. Patterns / conventions to follow
- Small, focused components under `src/app/components`. Create new UI components there and export default.
- UI primitives live under `src/app/components/ui` (dialog, sonner wrappers). Prefer these for consistent patterns.
- Styles are Tailwind-based; global styles in [src/styles/globals.css](src/styles/globals.css#L1-L40) and Tailwind config in `tailwind.config.js`.
- Keep logic that affects persistence or environment feature flags inside context/services (e.g., `AuthContext`, `walletService`).

6. Environment and local dev notes
- Use `.env` variables prefixed with `VITE_` for runtime checks in the client.
  - Common flags discovered: `VITE_APP_MOCK_MODE`, `VITE_APP_WALLET_CONNECTION_MOCK`.
- The project uses `noEmit` TypeScript and relies on `vite` for bundling; run `npm run build` to validate type-checking via `tsc -b`.

7. When editing or adding features
- If your change touches authentication or wallet flows, update localStorage keys explicitly and preserve backward compatibility with existing keys (`arctos_user`, `arctos_accounts`).
- Use existing dialogs and modals under `src/app/components/ui` to preserve UX patterns.
- Prefer environment-driven behavior for mocks rather than hard-coded flags.

8. Quick file examples
- Import using alias: `import Sidebar from '@components/Sidebar'` (alias defined in `vite.config.ts`).
- Wallet mock check: see [walletService.isMetaMaskAvailable](src/app/services/walletService.ts#L120-L130).

9. Testing / debugging tips
- Start `npm run dev` and open browser console for runtime wallet errors (MetaMask / OKX). WalletService logs errors to console.
- To reproduce email flows without a backend set `VITE_APP_MOCK_MODE=true` and use the localStorage `arctos_accounts` schema.

10. Questions to ask the human reviewer
- Should new global state use `zustand` (dependency present) or continue with context/local state? Point me to an example file to mirror.

If anything above is unclear or you'd like additional examples (component scaffolding, a recommended test command, or a sample PR template), tell me which section to expand.

11. Project plan & specifications
- For the full implementation plan, roadmap, and backend/Rust integration details see [PROJECT_SPECIFICATIONS.md](PROJECT_SPECIFICATIONS.md#L1-L120).
  - Use that file as the authoritative source for priorities (whale-tracking, price-aggregation, trade-book, sniper bot, etc.).
  - The spec includes recommended Rust services (Axum/Tokio), hosting suggestions, and a phased timeline.
