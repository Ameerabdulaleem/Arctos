# Rust dependencies for Arctos

This document explains the Rust crates referenced in `backend/Cargo.toml`, why they are included, and how to install/build the backend locally.

Prerequisites
- Install Rust toolchain (recommended):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install stable
```

- Optional helper: `cargo-edit` for adding crates interactively:

```bash
cargo install cargo-edit
```

Build the scaffold (will fetch all crates defined in `Cargo.toml`):

```bash
cd backend
cargo build
```

Crates (short descriptions)

- `axum` — HTTP web framework (routing, handlers). Used to provide REST endpoints and WebSocket upgrades.
- `tokio` — async runtime used by most async crates (Axum, reqwest, WebSockets). Feature `full` enables timers, net, macros.
- `tower` — middleware and service abstractions used by `axum`.
- `tower-http` — HTTP middleware helpers (CORS, tracing, compression). Enabled here with `trace` and `cors` features.
- `sqlx` — async SQL toolkit for Postgres/SQLite/MySQL. Included with `postgres`, `uuid`, and `json` features for DB access and JSON column support.
- `tokio-postgres` — Postgres client for use where lower-level control is required (optional alongside `sqlx`).
- `reqwest` — async HTTP client for calling free third-party APIs (CoinGecko, DEX aggregators).
- `serde` / `serde_json` — serialization/deserialization of JSON payloads (requests, API responses, DB JSON fields).
- `tokio-tungstenite` — WebSocket client/server support on top of Tokio (for real-time updates to frontend).
- `futures` — async utilities and combinators used frequently with streams and WebSockets.
- `solana-sdk` — Solana-specific SDK for parsing and interacting with Solana transactions (used for whale tracking on Solana).
- `web3` — Ethereum JSON-RPC client library for EVM chains (reading transactions, sending RPC queries).
- `uuid` — UUID generation and serde support for identifiers (DB records, job IDs).
- `chrono` — Date/time parsing and formatting, with serde integration for timestamps.
- `tracing` / `tracing-subscriber` — Structured logging and telemetry (preferred over `log` for async apps).
- `anyhow` — Ergonomic error handling in application code (convenient `Result<T, anyhow::Error>`).
- `thiserror` — Lightweight derive-based error types for domain errors.

Notes and recommendations
- The included `Cargo.toml` is a scaffold: running `cargo build` will download and compile the crates.
- If you want to add or update a crate, use `cargo add <crate>` (requires `cargo-edit`) or edit `Cargo.toml` and run `cargo build`.
- For DB-backed services, configure `DATABASE_URL` in environment and prefer `sqlx` with `sqlx-cli` for migrations (`cargo install sqlx-cli --no-default-features --features postgres`).
- For local development using WebSocket realtime flows, run the backend and point the frontend WebSocket client to `ws://localhost:4000` (or update port).

Next steps I can do for you
- Initialize `sqlx` migrations and example DB config.
- Add a WebSocket endpoint and a small example client in the frontend.
- Create a CI job to run `cargo build` on PRs.
