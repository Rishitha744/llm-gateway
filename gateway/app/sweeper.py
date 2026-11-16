"""Background reliability loop. One gateway replica sweeps at a time (leader
election with a session-level Postgres advisory lock).

Each tick it:
1. Dead-letters poison jobs: a job whose lease expired MAX_CLAIMS times keeps
   killing workers, so it is failed and published to the DLQ instead of looping.
2. Reclaims expired worker leases. A worker that crashed mid-job leaves the row in
   'processing'; once its lease passes, the job goes back to 'queued' (unpublished),
   and any late write from the old worker is rejected by the claim-token fence.
3. Relays the outbox: queued async jobs never acknowledged in Kafka (gateway crash
   or broker outage after the row was written) are published. Jobs still queued
   long after publication are re-published too, so a lost or skipped message can
   never strand a job (duplicates are harmless: claiming is idempotent).

Publishing happens strictly after the state change commits. A worker that read the
message before the commit would still see the old row and skip the job.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from app import config, db, jobs
from app.redis_client import r

log = logging.getLogger("gateway.sweeper")
LOCK_ID = 724_002
STATS_KEY = "sweeper:stats"


async def sweep_once() -> dict | None:
    async with db.pool.acquire() as conn:
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", LOCK_ID):
            return None  # another replica is the sweeper this tick
        try:
            async with conn.transaction():
                poisoned = await conn.fetch(
                    """
                    UPDATE requests SET status = 'failed', completed_at = now(),
                        claim_token = NULL,
                        error = 'worker lease expired ' || claims || ' times (poison job)'
                    WHERE status = 'processing' AND lease_until < now() AND claims >= $1
                    RETURNING id, tenant_id, error
                    """,
                    config.MAX_CLAIMS,
                )
                reclaimed = await conn.fetch(
                    """
                    UPDATE requests SET status = 'queued', claim_token = NULL,
                        lease_until = NULL, published_at = NULL
                    WHERE status = 'processing' AND lease_until < now()
                    RETURNING id
                    """
                )
            # Committed. Now it is safe to tell Kafka.
            for row in poisoned:
                await jobs.publish_dead_letter({
                    "job_id": row["id"], "tenant_id": row["tenant_id"], "error": row["error"],
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                })
            pending = await conn.fetch(
                """
                SELECT id, tenant_id, published_at IS NOT NULL AS stale FROM requests
                WHERE status = 'queued' AND kind = 'async'
                  AND ((published_at IS NULL AND created_at < now() - make_interval(secs => $1))
                       OR published_at < now() - make_interval(secs => $2))
                ORDER BY created_at LIMIT 500
                """,
                float(config.OUTBOX_GRACE_S), float(config.STALE_QUEUED_S),
            )
            for row in pending:
                await jobs.send(row["id"], row["tenant_id"])
                await conn.execute("UPDATE requests SET published_at = now() WHERE id = $1",
                                   row["id"])
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", LOCK_ID)

    reclaimed_ids = {row["id"] for row in reclaimed}
    stats = {
        "relayed": sum(1 for row in pending if not row["stale"] and row["id"] not in reclaimed_ids),
        "republished_stale": sum(1 for row in pending if row["stale"]),
        "reclaimed": len(reclaimed),
        "poisoned": len(poisoned),
    }
    pipe = r.pipeline()
    for k, v in stats.items():
        if v:
            pipe.hincrby(STATS_KEY, k, v)
    pipe.hset(STATS_KEY, mapping={"last_run": time.time(), "leader": config.INSTANCE_ID})
    await pipe.execute()
    if any(stats.values()):
        log.info(json.dumps({"msg": "sweeper", **stats}))
    return stats


async def run_forever():
    while True:
        try:
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - keep sweeping through transient outages
            log.warning(json.dumps({"msg": "sweeper tick failed", "error": repr(exc)[:200]}))
        await asyncio.sleep(config.SWEEP_INTERVAL_S)


async def stats() -> dict:
    raw = await r.hgetall(STATS_KEY)
    last = float(raw["last_run"]) if raw.get("last_run") else None
    return {
        "last_run": datetime.fromtimestamp(last, timezone.utc).isoformat() if last else None,
        "leader": raw.get("leader"),
        "interval_s": config.SWEEP_INTERVAL_S,
        "relayed": int(raw.get("relayed", 0)),
        "republished_stale": int(raw.get("republished_stale", 0)),
        "reclaimed": int(raw.get("reclaimed", 0)),
        "poisoned": int(raw.get("poisoned", 0)),
        "max_claims": config.MAX_CLAIMS,
    }
