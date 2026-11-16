-- Idempotent schema. Applied by the gateway on startup under an advisory lock,
-- so it is safe to run with many replicas and on an existing database.

CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    rate_limit_per_min INT NOT NULL DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'default';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- One row per request that reached the model layer (sync or async).
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_key_id INT REFERENCES api_keys(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,                 -- 'async' | 'sync'
    status TEXT NOT NULL,               -- queued | processing | done | failed
    cached BOOLEAN NOT NULL DEFAULT FALSE,
    model TEXT NOT NULL,
    max_tokens INT NOT NULL DEFAULT 300,
    prompt TEXT NOT NULL,
    result TEXT,
    error TEXT,
    attempts INT NOT NULL DEFAULT 0,
    prompt_tokens INT,
    completion_tokens INT,
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
-- Reliability: provider attribution, streaming TTFT, client idempotency keys,
-- the outbox marker (published_at) and worker leases with a fencing token.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS ttft_ms INT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS claims INT NOT NULL DEFAULT 0;
-- Rows that existed before the outbox column count as already published.
UPDATE requests SET published_at = created_at
    WHERE published_at IS NULL AND status <> 'queued' AND kind = 'async';

CREATE UNIQUE INDEX IF NOT EXISTS requests_idempotency_idx
    ON requests (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_unpublished_idx
    ON requests (created_at) WHERE status = 'queued' AND published_at IS NULL;
CREATE INDEX IF NOT EXISTS requests_leases_idx
    ON requests (lease_until) WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS requests_tenant_created_idx ON requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests (created_at DESC);
CREATE INDEX IF NOT EXISTS requests_failed_idx ON requests (created_at DESC) WHERE status = 'failed';
