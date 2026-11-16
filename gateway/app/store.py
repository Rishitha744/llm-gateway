"""Persistence for request records (the source of truth for jobs and analytics)."""
from datetime import datetime, timedelta, timezone

from app import db, metrics

JOB_COLUMNS = """
    r.id, r.tenant_id, t.name AS tenant_name, r.kind, r.status, r.cached, r.model,
    r.max_tokens, r.prompt, r.result, r.error, r.attempts, r.prompt_tokens,
    r.completion_tokens, r.latency_ms, r.created_at, r.started_at, r.completed_at,
    r.provider, r.ttft_ms, r.claims, r.idempotency_key
"""


def serialize(row) -> dict:
    d = dict(row)
    created, started, completed = d["created_at"], d["started_at"], d["completed_at"]
    d["queue_ms"] = int((started - created).total_seconds() * 1000) if started else None
    d["total_ms"] = int((completed - created).total_seconds() * 1000) if completed else None
    for k in ("created_at", "started_at", "completed_at"):
        d[k] = d[k].isoformat() if d[k] else None
    return d


async def insert_request(
    *,
    id: str,
    tenant_id: int,
    api_key_id: int | None,
    kind: str,
    status: str,
    model: str,
    max_tokens: int,
    prompt: str,
    cached: bool = False,
    result: str | None = None,
    error: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    latency_ms: int | None = None,
    finished: bool = False,
    provider: str | None = None,
    ttft_ms: int | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Insert a request row. Returns False if the idempotency key was already used."""
    now = datetime.now(timezone.utc)
    started = now - timedelta(milliseconds=latency_ms or 0)
    async with db.pool.acquire() as conn:
        inserted = await conn.fetchval(
            """
            INSERT INTO requests (id, tenant_id, api_key_id, kind, status, cached, model,
                max_tokens, prompt, result, error, prompt_tokens, completion_tokens,
                latency_ms, created_at, started_at, completed_at, attempts, provider,
                ttft_ms, idempotency_key)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING true
            """,
            id, tenant_id, api_key_id, kind, status, cached, model, max_tokens, prompt,
            result, error, prompt_tokens, completion_tokens, latency_ms,
            started if finished else now,
            started if finished else None,
            now if finished else None,
            1 if finished and not cached else 0,
            provider, ttft_ms, idempotency_key,
        )
    return bool(inserted)


async def find_by_idempotency_key(tenant_id: int, key: str) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT {JOB_COLUMNS} FROM requests r JOIN tenants t ON t.id = r.tenant_id
            WHERE r.tenant_id = $1 AND r.idempotency_key = $2
            """,
            tenant_id, key,
        )
    return serialize(row) if row else None


async def mark_published(job_id: str):
    """Outbox acknowledgement: the job ID is durably in Kafka."""
    async with db.pool.acquire() as conn:
        await conn.execute(
            "UPDATE requests SET published_at = now() WHERE id = $1 AND published_at IS NULL",
            job_id,
        )


async def mark_failed(job_id: str, error: str):
    async with db.pool.acquire() as conn:
        await conn.execute(
            "UPDATE requests SET status = 'failed', error = $2, completed_at = now() WHERE id = $1",
            job_id, error[:300],
        )


async def requeue(job_id: str) -> bool:
    """Reset a failed job so a worker will pick it up again."""
    async with db.pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE requests SET status = 'queued', error = NULL, result = NULL,
                started_at = NULL, completed_at = NULL, latency_ms = NULL, attempts = 0,
                claims = 0, claim_token = NULL, lease_until = NULL, published_at = NULL
            WHERE id = $1 AND status = 'failed' AND kind = 'async'
            """,
            job_id,
        )
    return result.endswith(" 1")


async def queue_depth() -> dict:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT count(*) FILTER (WHERE status = 'queued') AS queued,
                   count(*) FILTER (WHERE status = 'processing') AS processing,
                   min(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at,
                   count(*) FILTER (WHERE status = 'queued' AND published_at IS NULL)
                       AS unpublished,
                   count(*) FILTER (WHERE status = 'processing' AND lease_until < now())
                       AS expired_leases
            FROM requests WHERE status IN ('queued', 'processing')
            """
        )
    d = dict(row)
    d["oldest_queued_at"] = d["oldest_queued_at"].isoformat() if d["oldest_queued_at"] else None
    return d


async def get_request(job_id: str, tenant_id: int | None = None) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT {JOB_COLUMNS} FROM requests r JOIN tenants t ON t.id = r.tenant_id
            WHERE r.id = $1 AND ($2::int IS NULL OR r.tenant_id = $2)
            """,
            job_id, tenant_id,
        )
    return serialize(row) if row else None


async def list_requests(
    *,
    tenant_id: int | None,
    status: str | None,
    q: str | None,
    before: datetime | None,
    limit: int,
) -> list[dict]:
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT {JOB_COLUMNS} FROM requests r JOIN tenants t ON t.id = r.tenant_id
            WHERE ($1::int IS NULL OR r.tenant_id = $1)
              AND ($2::text IS NULL OR r.status = $2 OR ($2 = 'cached' AND r.cached))
              AND ($3::text IS NULL OR r.prompt ILIKE '%' || $3 || '%' OR r.id = $3)
              AND ($4::timestamptz IS NULL OR r.created_at < $4)
            ORDER BY r.created_at DESC
            LIMIT $5
            """,
            tenant_id, status, q, before, limit,
        )
    return [serialize(r) for r in rows]


RANGES = {
    "1h": (timedelta(hours=1), 300),
    "24h": (timedelta(hours=24), 3600),
    "7d": (timedelta(days=7), 6 * 3600),
}

USAGE_AGG = """
    count(*) AS total,
    count(*) FILTER (WHERE cached) AS cached,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    count(*) FILTER (WHERE status = 'done') AS succeeded,
    count(*) FILTER (WHERE status IN ('queued', 'processing')) AS in_flight,
    coalesce(sum(prompt_tokens) FILTER (WHERE NOT cached), 0) AS prompt_tokens,
    coalesce(sum(completion_tokens) FILTER (WHERE NOT cached), 0) AS completion_tokens,
    coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))
        FILTER (WHERE cached), 0) AS tokens_saved,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE status = 'done' AND NOT cached) AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE status = 'done' AND NOT cached) AS p95_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms)
        FILTER (WHERE ttft_ms IS NOT NULL AND NOT cached) AS ttft_p50_ms
"""


def _clean(row) -> dict:
    d = dict(row)
    d.pop("bucket", None)
    for k in ("p50_ms", "p95_ms", "ttft_p50_ms"):
        d[k] = round(d[k]) if d[k] is not None else None
    return d


async def usage(tenant_ids: list[int] | None, range_key: str) -> dict:
    span, bucket_s = RANGES[range_key]
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    first_bucket = (now_epoch - int(span.total_seconds())) // bucket_s * bucket_s + bucket_s
    since = datetime.fromtimestamp(first_bucket, timezone.utc)

    async with db.pool.acquire() as conn:
        if tenant_ids is None:
            tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants")]
        totals = await conn.fetchrow(
            f"SELECT {USAGE_AGG} FROM requests WHERE created_at >= $1 AND tenant_id = ANY($2)",
            since, tenant_ids,
        )
        rows = await conn.fetch(
            f"""
            SELECT date_bin($1::interval, created_at, 'epoch'::timestamptz) AS bucket, {USAGE_AGG}
            FROM requests WHERE created_at >= $2 AND tenant_id = ANY($3)
            GROUP BY bucket ORDER BY bucket
            """,
            timedelta(seconds=bucket_s), since, tenant_ids,
        )

    rl = await metrics.rate_limited_series(tenant_ids, first_bucket, now_epoch, bucket_s)
    by_bucket = {int(r["bucket"].timestamp()): _clean(r) for r in rows}
    empty = {k: 0 for k in _clean(totals)} | {"p50_ms": None, "p95_ms": None, "ttft_p50_ms": None}
    series = []
    for b in range(first_bucket, now_epoch + 1, bucket_s):
        point = by_bucket.get(b, empty) | {"rate_limited": rl.get(b, 0)}
        series.append({"t": datetime.fromtimestamp(b, timezone.utc).isoformat(), **point})

    summary = _clean(totals) | {"rate_limited": sum(rl.values())}
    total = summary["total"]
    summary["cache_hit_rate"] = summary["cached"] / total if total else 0
    summary["error_rate"] = summary["failed"] / total if total else 0
    return {"range": range_key, "bucket_seconds": bucket_s, "summary": summary, "series": series}


async def model_breakdown(tenant_id: int | None, range_key: str) -> list[dict]:
    span, _ = RANGES[range_key]
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT model, count(*) AS total,
                   coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))
                       FILTER (WHERE NOT cached), 0) AS tokens
            FROM requests
            WHERE created_at >= now() - $1::interval AND ($2::int IS NULL OR tenant_id = $2)
            GROUP BY model ORDER BY total DESC
            """,
            span, tenant_id,
        )
    return [dict(r) for r in rows]
