#!/bin/bash
# Test tooling: starts the Rust service against the local fixture server (see server.mjs).
set -e
F=http://127.0.0.1:${FIXTURE_PORT:-4999}
cd "$(dirname "$0")/../../backend"
PORT=4000 HOST=127.0.0.1 COINGECKO_BASE=$F/cg FNG_URL=$F/fng/ BINANCE_REST_BASES=$F BINANCE_WS_URL=ws://127.0.0.1:1/x GECKOTERMINAL_BASE=$F/gt GOPLUS_BASE=$F/goplus DEXSCREENER_BASE=$F/dex YAHOO_BASE=$F/yahoo BLOCKCHAIR_BASE=$F/blockchair ETH_RPC_URL=$F/rpc BSC_RPC_URL=$F/rpc BASE_RPC_URL=$F/rpc ARBITRUM_RPC_URL=$F/rpc SOLANA_RPC_URL=$F/rpc ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE=$F/anthropic NEWS_FEEDS="CoinDesk|$F/rss,Decrypt|$F/rss" RUST_LOG=arctos_backend=info exec cargo run --quiet
