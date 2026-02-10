# ARCTOS - Project Specifications & Implementation Plan

## Template & Instructions - Saved

### Project Overview
**Project Name:** Arctos  
**Description:** A multi-chain crypto trading platform with wallet integration, AI-powered features, whale tracking, and advanced trading tools.  
**Timeline:** 2 months (gradual public build)  
**Hosting:** Vercel (free tier)  
**APIs:** Free APIs only (no paid services)

---

## Part 1: Core Platform Template & Features

### Supported Blockchains
- Solana
- BNB Chain
- Ethereum
- Base

### Homepage Features
- Brand information and overview
- **Wallet Connection Button** (replace with real wallet connection)
  - Real wallet icons
  - Options:
    - MetaMask
    - Rabby Wallet
    - Phantom
    - OKX Wallet
    - Hot Wallet / Create New Wallet
- Figma mockups (keep 3 mockups per section for now - remove later)

---

### Dashboard
**Features:**
- Display tokens, NFTs, and DeFi staking across all 4 chains (when wallet connected)
- **Real-time Widgets:**
  - Portfolio Value (when wallet connected)
  - Altseason Index
  - Market Dominance
  - Total Crypto Market Cap
- Support multiple connected wallets

**Data Source:** Real-time blockchain data APIs

---

### Trading Terminal
**Features:**
- Display wallet tokens
- Buy/Sell options with:
  - Market orders
  - Limit orders
- Users can set buying/selling limits anytime
- Notifications when limits are triggered

---

### Sniper Panel
**Features:**
- Requires wallet connection or new wallet creation before use
- Sniper bot functionality
- Consider: BonkBot or BasedBot setup/integration
- Real-time token monitoring

---

### Whale Tracking / Whale Alerts
**Features:**
- Display all 4 chains tokens held by tracked whales
- Real-time notifications when whales buy/sell tokens
- **WhatsApp Integration:**
  - Allow users to connect WhatsApp number to Arctos
  - Send WhatsApp notifications when tracked whales make transactions
  - Reference: Ali-Baba Store WhatsApp integration model
  - Check: Relay.com or similar for free WhatsApp API

**Data Source:** Real-time whale tracking APIs

---

### Fundamental News Tab
**Features:**
- Live data (currently mockup)
- Tab categories:
  - Total Articles
  - Trending Now
  - High Impact
  - Medium Impact
  - Low Impact
- Filter capabilities
- Keep Figma mockups (3 per section initially)

**Data Source:** Live news APIs (CoinGecko, Messari, or similar free news feeds)

---

### AI Chat Feature
**Features:**
1. **Token Swapping via Natural Language**
   - Example: "Swap 0.002 SOL to USDT"
   - Multi-chain swap support (Solana, BNB, Ethereum, Base)
   
2. **Integrated DEX APIs (Free):**
   - Jupiter (Solana)
   - Raydium (Solana)
   - SushiSwap (Multi-chain)
   - PancakeSwap (BNB, Ethereum, Base)
   - **Additional 4 DEX recommendations needed**

3. **Token Bridging**
   - Cross-chain bridge support (between 4 networks)
   - Free API: Relay.com or similar intent-based bridging
   - Natural language instructions for bridging

---

### Trade Book / Portfolio Tracker
**Features:**
1. **Automatic Token Detection:**
   - Auto-detect user's purchased tokens
   - Calculate profit/loss based on purchase price vs current price
   - No manual input required
   - Exception: Manual entry option for untracked tokens

2. **Portfolio Metrics:**
   - Individual token P/L display
   - Total trades count
   - Win rate percentage
   - Total profit
   - Total loss
   - Net P/L

3. **Data:**
   - Track from initial purchase to current
   - Real-time price updates
   - Historical purchase data from blockchain

---

### Settings Page
**Features** (per Figma design):
- **Appearance:** Dark mode / Light mode
- **Language & Region:** Multi-language support
- **Notifications:** Push, email, SMS preferences
- **Account Settings:** Profile management
- **Security:** 2FA implementation
- **Two-Factor Authentication:** SMS/Auth app options

---

### Multi-Wallet Support
**Features:**
- Users can add up to 5 different wallets
- Switch between wallets seamlessly
- Each wallet maintains separate history and settings
- Display active wallet status

---

### Authentication Options
- **Wallet Connection** (for most features)
- **Email Authentication** (for basic features like Whale Alerts and Trade Book)
- Users must authenticate to access features

---

## Part 2: Sniper Bot Template & Instructions

### Sniper Bot Implementation
- **Setup Options:** BonkBot or BasedBot structure
- **Free API Usage:** No paid bot services
- **Features:**
  - Auto-buy on token launch
  - Stop-loss settings
  - Take-profit settings
  - Slippage control
  - Real-time monitoring

---

## Integration Requirements

### Free APIs to Integrate
1. **Wallet Data:** Solana (on-chain), Ethers.js, Web3.js, Alchemy
2. **DEX Aggregators:** Jupiter API, 1inch API, 0x Protocol
3. **Token Pricing:** CoinGecko API, DefiLlama API
4. **News/Data:** MessariAPI, Alchemy Notify, TheGraph
5. **Whale Tracking:** Custom RPC calls or Etherscan/Solscan APIs
6. **WhatsApp Integration:** Twilio (free tier) or similar
7. **Bridging:** Relay.com, Li.Finance

---

## Development Timeline & Social Media

### Timeline: 2 Months (Gradual Public Build)

### Social Media Posting Schedule
**Frequency:** 2 posts per week (Tuesday & Thursday)  
**Platforms:**
- LinkedIn
- Facebook
- X (Twitter)

**Post Content:**
- Implementation updates
- Feature completions
- Code snippets
- Architecture decisions
- Progress milestones

---

## File Structure (from Figma)
*To be provided by user - will be integrated into this doc*

---

## Technology Stack
- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS + shadcn/ui
- **Wallet Integration:** @solana/web3.js, ethers.js, web3.js
- **State Management:** Zustand
- **HTTP Client:** Axios
- **Charts:** Recharts
- **Forms:** React Hook Form + Zod
- **UI Icons:** Lucide React
- **Notifications:** Sonner
- **Hosting:** Vercel (Frontend)

---

## Part 3: Rust Backend Integration

### Where Rust Fits in ARCTOS
Rust will power high-performance backend services for real-time features while keeping free APIs.

### Recommended Rust Backend Architecture

**Backend Framework:** Axum or Actix-web  
**Async Runtime:** Tokio  
**Database:** PostgreSQL (free tier) or SQLite  
**Real-time:** WebSocket support  
**Hosting:** Railway.app, Render, or Fly.io (free tier)

### Rust Implementation Areas (Priority Order)

#### 1. **Real-time Whale Tracking Service** ⭐ High Priority
- Monitor all 4 chains simultaneously
- Aggregate whale transactions from free RPC endpoints
- Cache whale data efficiently
- WebSocket push to frontend for instant alerts
- Detect patterns across multiple transactions
- Optimized memory usage for processing thousands of wallets

**Why Rust:** Concurrent monitoring of multiple chains, low latency, memory efficient

#### 2. **Multi-Chain Price Aggregation Service** ⭐ High Priority
- Combine prices from multiple free DEX APIs (Jupiter, PancakeSwap, Raydium)
- Real-time OHLCV data processing
- Price deviation detection
- Caching layer to reduce API calls
- WebSocket stream to dashboard widgets

**Why Rust:** Fast data processing, handles concurrent API calls, efficient memory usage

#### 3. **Trade Book / P&L Calculator** ⭐ High Priority
- Auto-detect purchased tokens from blockchain
- Calculate real-time P/L across thousands of transactions
- Historical data processing
- Profit/loss aggregation by token, date, chain
- Handle complex calculations instantly

**Why Rust:** CPU-intensive calculations, handles large datasets efficiently, no performance degradation

#### 4. **Transaction Indexer & Monitor** 🟡 Medium Priority
- Index user wallet transactions across all 4 chains
- Monitor for buy/sell events automatically
- Parse DEX transactions (swaps, liquidity changes)
- Store transaction history efficiently
- Retrieve historical data instantly

**Why Rust:** Process thousands of transactions quickly, efficient storage, fast queries

#### 5. **WhatsApp Notification Worker** 🟡 Medium Priority
- Background job processor for WhatsApp alerts
- Queue management for notifications
- Rate limiting to stay within free API limits
- Retry logic for failed notifications
- User subscription management

**Why Rust:** Async job processing, handles concurrent notifications, resource-efficient

#### 6. **API Gateway / Rate Limiter** 🟡 Medium Priority
- Cache expensive API calls (CoinGecko, DefiLlama)
- Rate limit management across multiple free APIs
- Request batching to reduce API calls

---

## Mailchimp Waitlist Integration (New)

Goal: add new waitlist subscribers to a Mailchimp audience and trigger Mailchimp's automated welcome email (free tier). Implement a small server-side proxy to keep the Mailchimp API key secret and call the Mailchimp Marketing API.

Implementation steps:

- Install dependencies:

  ```bash
  npm install @mailchimp/mailchimp_marketing express cors dotenv
  npm install --save-dev nodemon
  ```

- Files added to repository:

  - `server/mailchimp-server.js` — small Express server that exposes `POST /api/waitlist` and calls Mailchimp to add the member to your audience.
  - `.env.example` — example environment variables to copy into `.env`.

- Required Mailchimp setup (what you must do in Mailchimp):

  1. Sign up at mailchimp.com using `arctosapp@gmail.com` and create an account.
  2. Create or choose an Audience (List) for the waitlist and note the Audience ID (List ID). You'll need this for `MAILCHIMP_LIST_ID`.
  3. Create an API key in your Mailchimp account (Account -> Extras -> API keys). The API key has a suffix like `-us1`; the `us1` part is your server prefix.
  4. (Optional) In the Audience settings enable an automated "Welcome" email so new subscribers receive a confirmation/welcome email automatically. Automations are available on free tiers for basic welcome emails.

- Environment variables (add to `.env`):

  - `MAILCHIMP_API_KEY` — your Mailchimp API key (keep secret).
  - `MAILCHIMP_SERVER_PREFIX` — e.g. `us1` (the datacenter prefix from the API key).
  - `MAILCHIMP_LIST_ID` — the Audience (List) ID you want to add members to.
  - `ALLOWED_ORIGIN` — (optional) `http://localhost:5173` for local dev.

- How it works in this repo:

  - The frontend (`src/app/components/Homepage.tsx`) now sends `POST /api/waitlist` with `{ email }` when a user submits the waitlist form.
  - The Express proxy (`server/mailchimp-server.js`) receives the request, forwards the email to Mailchimp via `@mailchimp/mailchimp_marketing` server-side SDK, and returns success to the client.
  - Mailchimp (if you enable the Audience welcome automation) will send the confirmation/welcome email to the user automatically.

- Running locally:

  1. Copy `.env.example` to `.env` and fill in your Mailchimp values.
  2. Start the API server in a separate terminal:

     ```bash
     npm run start:api
     # or, for auto-reload during development
     npm run dev:api
     ```

  3. Start the frontend dev server as usual:

     ```bash
     npm run dev
     ```

- Deploy notes:

  - For production, host the API as a serverless function (Vercel Serverless Function, Netlify Functions, or a small Node host) and point the frontend to that URL. Keep the Mailchimp API key secret in the host's environment variables.
  - Alternatively, integrate the Mailchimp call into your Rust backend if you deploy a Rust service — still keep the API key server-side.

Security & privacy notes:

- Never expose `MAILCHIMP_API_KEY` in client-side code or in public repos. Use environment variables in your server or hosting provider.
- Ensure you comply with Mailchimp's requirements about double opt-in and GDPR if you target EU users (Mailchimp provides audience and consent features).

If you'd like, I can also:

- Wire a Vercel serverless function instead of a standalone Express server.
- Add UI feedback to the frontend for API errors.
- Add server-side logging and retry/backoff in the proxy.
- Load balancing between multiple endpoints
- Fallback mechanisms

**Why Rust:** Ultra-fast caching, intelligent rate limiting, prevents API ban

#### 7. **Sniper Bot Service** 🔴 Lower Priority
- Real-time token launch detection
- Automated buying logic
- Stop-loss/take-profit execution
- Slippage calculation and optimization
- Transaction signing and sending

**Why Rust:** Critical for low-latency trading, handles microsecond timing

#### 8. **News Aggregator Service** 🔴 Lower Priority
- Collect news from multiple free sources
- Categorize by impact level
- Sentiment analysis (optional)
- Real-time filtering
- Push updates to users

**Why Rust:** Process thousands of articles, text analysis, efficient filtering

---

### Rust + React Communication

**Communication Protocol:** WebSocket + REST API
- WebSocket for real-time updates (prices, whale alerts, notifications)
- REST API for data queries (historical data, user settings)
- Server-Sent Events (SSE) as fallback

**Data Flow:**
```
React Frontend (Vite)
       ↓
 WebSocket Connection
       ↓
 Rust Backend (Axum/Actix)
       ↓
  Free APIs (Jupiter, CoinGecko, etc.)
```

---

### Free Rust Hosting Options

1. **Railway.app** - Free tier, easy deployment, good for prototyping
2. **Render.com** - Free tier, auto-deploy from GitHub, 15-min idle timeout
3. **Fly.io** - Free tier, global deployment, low latency
4. **Heroku** (Limited free tier) - If budget allows
5. **Self-hosted on VPS** - DigitalOcean $5/month

**Recommendation:** Start with Railway or Render for simplicity, migrate to Fly.io for global reach

---

### Rust Dependencies (Free & Open Source)

```toml
# Web Framework
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["trace", "cors"] }

# Database
sqlx = { version = "0.7", features = ["postgres", "uuid", "json"] }
tokio-postgres = "0.7"

# API Clients
reqwest = { version = "0.11", features = ["json"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Real-time
tokio-tungstenite = "0.21"
futures = "0.3"

# Blockchain
solana-sdk = "1.18"
web3 = "0.20"

# Utilities
uuid = { version = "1.0", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = "0.3"
anyhow = "1.0"
thiserror = "1.0"
```

---

### Implementation Strategy

**Phase 1 (Week 1-2):** Set up Rust backend structure
- Create Axum project
- Set up WebSocket support
- Configure database schema
- Create free API integrations

**Phase 2 (Week 3-4):** Build real-time services
- Whale tracking service
- Price aggregation service
- WebSocket streaming to frontend

**Phase 3 (Week 5-6):** Advanced features
- Trade book calculator
- Transaction indexer
- Notification worker

**Phase 4 (Week 7-8):** Optimization & deployment
- Performance tuning
- Load testing
- Deploy to free hosting
- Monitor and optimize

---

### Rust + Vite Integration Example

**Frontend (React):**
```typescript
// WebSocket connection to Rust backend
const ws = new WebSocket('ws://localhost:3000/ws/prices');

ws.onmessage = (event) => {
  const priceUpdate = JSON.parse(event.data);
  // Update dashboard widgets in real-time
  updatePortfolioValue(priceUpdate);
};
```

**Backend (Rust):**
```rust
// Axum WebSocket handler
async fn websocket_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket))
}

async fn handle_socket(socket: WebSocket) {
    // Stream price updates to all connected clients
    loop {
        let price = fetch_aggregated_price().await;
        socket.send(Message::Text(serde_json::to_string(&price)?)).await?;
    }
}
```

---

### Key Benefits of Rust Backend

✅ **Performance:** 10-100x faster than Node.js for CPU-intensive tasks  
✅ **Concurrency:** Handle thousands of concurrent whale monitoring jobs  
✅ **Memory Safety:** No memory leaks, no crashes from null pointer errors  
✅ **Free:** Open-source, no licensing costs  
✅ **Scalability:** Efficiently handles data processing without degradation  
✅ **Real-time:** Sub-millisecond latency for price/whale updates  

---

### What NOT to Use Rust For

❌ UI rendering (use React)  
❌ Form validation (use React Hook Form)  
❌ Animation (use CSS/Framer Motion)  
❌ Simple API proxying (can use Vercel functions)  
❌ Authentication UI (use React components)

---

## Updated Tech Stack (Full)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React + TypeScript | UI/UX |
| **Styling** | Tailwind CSS + shadcn/ui | Design system |
| **State** | Zustand | Client state |
| **Backend** | Rust (Axum) | Real-time services |
| **Real-time** | WebSocket | Live updates |
| **Database** | PostgreSQL | Persistent storage |
| **Hosting (Frontend)** | Vercel | Static site |
| **Hosting (Backend)** | Railway/Render/Fly.io | API services |
| **Blockchain** | Web3.js, Ethers.js, Solana SDK | Chain interaction |

---

---

## Implementation Notes
- Keep Figma mockups (3 per section) during development
- Build gradually and publicly
- Prioritize wallet connection and basic dashboard first
- Free APIs only - monitor rate limits
- Test on testnet before mainnet
- Implement proper error handling for blockchain calls
- Consider gas optimization for Ethereum/Base

---

## Next Steps
1. Await Figma UI file structure from user
2. Set up component files based on file structure
3. Implement features in priority order
4. Begin social media posting schedule (Tuesday & Thursday)
5. Regular deployment to Vercel for public visibility

---

**Status:** Specifications Saved - Ready for Implementation  
**Date Created:** February 3, 2026  
**Last Updated:** February 3, 2026
