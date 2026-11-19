-- Arctos database, version 1.
--
-- Everything lives in its own schema, "arctos", so nothing is reachable
-- through the automatic API some hosts (Supabase among them) put in front of
-- the "public" schema. Row level security is switched on for every table with
-- no policies: only the table owner, which is the data service, can read or
-- write. The data service applies this file itself (see src/db.rs), inside one
-- transaction, and records it in arctos.schema_migrations.

CREATE SCHEMA IF NOT EXISTS arctos;
REVOKE ALL ON SCHEMA arctos FROM PUBLIC;

CREATE TABLE IF NOT EXISTS arctos.schema_migrations (
    version    INT         PRIMARY KEY,
    name       TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Waitlist ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arctos.waitlist (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Stored lower case, so one person can only join once.
    email      TEXT        NOT NULL UNIQUE
               CHECK (email = lower(email) AND char_length(email) BETWEEN 6 AND 254),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signups from the earlier layout, which kept the waitlist in "public".
DO $$
BEGIN
    IF to_regclass('public.waitlist') IS NOT NULL THEN
        INSERT INTO arctos.waitlist (email, created_at)
        SELECT lower(email), created_at FROM public.waitlist
        WHERE char_length(email) BETWEEN 6 AND 254
        ORDER BY id
        ON CONFLICT (email) DO NOTHING;
    END IF;
END $$;

-- ── Trade keeper: open snipes and the sales made for them ───────────────────

CREATE TABLE IF NOT EXISTS arctos.keeper_positions (
    -- A hash of the browser's random key. The key itself is never stored.
    owner      TEXT    NOT NULL,
    -- chain:address of the token.
    key        TEXT    NOT NULL,
    body       JSONB   NOT NULL,
    -- Every write names the version it read, so two writers can never both win.
    version    BIGINT  NOT NULL DEFAULT 1,
    open       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Unix milliseconds.
    checked_at BIGINT  NOT NULL DEFAULT 0,
    synced_at  BIGINT  NOT NULL,
    PRIMARY KEY (owner, key)
);
CREATE INDEX IF NOT EXISTS keeper_positions_due
    ON arctos.keeper_positions (checked_at) WHERE open;

CREATE TABLE IF NOT EXISTS arctos.keeper_executions (
    id         TEXT   PRIMARY KEY,
    owner      TEXT   NOT NULL,
    key        TEXT   NOT NULL,
    body       JSONB  NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS keeper_executions_owner
    ON arctos.keeper_executions (owner, created_at);

CREATE TABLE IF NOT EXISTS arctos.keeper_meta (
    id           INT    PRIMARY KEY CHECK (id = 1),
    next_tick_at BIGINT NOT NULL DEFAULT 0,
    last_tick_at BIGINT NOT NULL DEFAULT 0,
    -- When old records were last cleared out.
    cleaned_at   BIGINT NOT NULL DEFAULT 0
);
INSERT INTO arctos.keeper_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Sniper: token checks and developer track records ────────────────────────

-- The result of a full check of one token (developer wallet, holders,
-- authorities). Shared by every copy of the service, so a slow check is made
-- once and reused.
CREATE TABLE IF NOT EXISTS arctos.token_checks (
    chain      TEXT        NOT NULL,
    token      TEXT        NOT NULL,
    developer  TEXT,
    report     JSONB       NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain, token)
);
CREATE INDEX IF NOT EXISTS token_checks_checked_at ON arctos.token_checks (checked_at);

-- Every launch seen from a developer wallet and how it did, kept so a
-- developer is judged on their whole record, not only on what one running
-- copy of the service happened to see.
CREATE TABLE IF NOT EXISTS arctos.dev_launches (
    chain          TEXT             NOT NULL,
    token          TEXT             NOT NULL,
    developer      TEXT             NOT NULL,
    graduated      BOOLEAN          NOT NULL DEFAULT FALSE,
    on_curve       BOOLEAN          NOT NULL DEFAULT FALSE,
    liquidity_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
    market_cap_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Share of recent trades that were buys, 0 to 1.
    buy_ratio      DOUBLE PRECISION CHECK (buy_ratio BETWEEN 0 AND 1),
    first_seen_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (chain, token)
);
CREATE INDEX IF NOT EXISTS dev_launches_developer
    ON arctos.dev_launches (chain, developer, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS dev_launches_last_seen ON arctos.dev_launches (last_seen_at);

-- One line per developer, for reading the records by hand. The success rule
-- matches DevLaunch::succeeded in src/launchpad.rs.
CREATE OR REPLACE VIEW arctos.developer_records WITH (security_invoker = true) AS
SELECT
    chain,
    developer,
    count(*) AS launches,
    count(*) FILTER (
        WHERE graduated
           OR (NOT on_curve AND liquidity_usd >= 10000 AND market_cap_usd >= 100000)
    ) AS successes,
    round((avg(buy_ratio) * 100)::numeric, 1) AS avg_buy_pct,
    max(last_seen_at) AS last_seen_at
FROM arctos.dev_launches
GROUP BY chain, developer;

-- ── Lock every table ────────────────────────────────────────────────────────

ALTER TABLE arctos.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.waitlist          ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.keeper_positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.keeper_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.keeper_meta       ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.token_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arctos.dev_launches      ENABLE ROW LEVEL SECURITY;

INSERT INTO arctos.schema_migrations (version, name)
VALUES (1, 'arctos schema') ON CONFLICT (version) DO NOTHING;
