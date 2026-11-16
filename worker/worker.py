"""Kafka consumer that runs queued prompts against the upstream providers.

Delivery is at-least-once, so processing is made safe to repeat:

* Claiming takes a lease. A worker atomically moves a job queued -> processing,
  stamps a random claim token and a lease deadline. A redelivered message for a
  job that is done, or that another worker holds a live lease on, is a no-op.
* Leases expire. If this worker dies mid-job, the gateway sweeper sees the lapsed
  lease and re-queues the job (and dead-letters it after MAX_CLAIMS lost leases).
* Writes are fenced. Every update is conditioned on the claim token, so a worker
  that lost its lease (e.g. a network partition) can never overwrite the new owner.
* Leases are kept alive. While a job runs, a keeper renews the lease every LEASE_S/3;
  if a renewal finds the lease gone, the upstream call is cancelled.

Transient failures are retried with exponential backoff and jitter; the shared
router fails over between providers and skips ones whose circuit is open.
"""
import asyncio
import json
import os
import random
import signal
import socket
import uuid
from datetime import datetime, timezone

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from common.cache_key import make_key
from common.providers import FatalError, RetryableError, Router, load_providers

TOPIC = "jobs"
DLQ_TOPIC = "jobs-dlq"
GROUP = "workers"
MAX_ATTEMPTS = int(os.environ.get("WORKER_MAX_ATTEMPTS", "4"))
CACHE_TTL_S = int(os.environ.get("CACHE_TTL_S", "3600"))
LLM_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "60"))
# Lease length. A keeper task renews it every LEASE_S/3 while the job runs, so it
# only needs to cover a missed renewal or two; it bounds crash-detection time.
LEASE_S = int(os.environ.get("LEASE_S") or 30)
WORKER_ID = socket.gethostname()

r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
router = Router(load_providers(), r,
                threshold=int(os.environ.get("CB_THRESHOLD", "5")),
                cooldown_s=float(os.environ.get("CB_COOLDOWN_S", "30")))

state = {
    "id": WORKER_ID,
    "started_at": datetime.now(timezone.utc).isoformat(),
    "processed": 0,
    "failed": 0,
    "retries": 0,
    "lost_leases": 0,
    "current_job": None,
}


def log(msg: str, **fields):
    print(json.dumps({"msg": msg, "worker": WORKER_ID, **fields}), flush=True)


class LeaseLost(Exception):
    pass


async def renew_lease(pool, job_id: str, token: str, attempt: int | None = None):
    ok = await pool.fetchval(
        """
        UPDATE requests SET attempts = coalesce($3, attempts),
            lease_until = now() + make_interval(secs => $4)
        WHERE id = $1 AND claim_token = $2 AND status = 'processing'
        RETURNING true
        """,
        job_id, token, attempt, float(LEASE_S),
    )
    if not ok:
        raise LeaseLost(job_id)


async def keep_lease(pool, job_id: str, token: str):
    """Runs alongside the upstream call; returns only if the lease was lost."""
    while True:
        await asyncio.sleep(LEASE_S / 3)
        try:
            await renew_lease(pool, job_id, token)
        except LeaseLost:
            return
        except Exception as exc:  # noqa: BLE001 - DB blip: try again next tick
            log("lease renewal failed", job_id=job_id, error=repr(exc)[:200])


async def run_with_lease(pool, job_id: str, token: str, coro):
    work = asyncio.create_task(coro)
    keeper = asyncio.create_task(keep_lease(pool, job_id, token))
    try:
        await asyncio.wait({work, keeper}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        keeper.cancel()
    if not work.done():  # the keeper returned: lease lost, abandon the call
        work.cancel()
        await asyncio.gather(work, return_exceptions=True)
        raise LeaseLost(job_id)
    return work.result()


async def call_llm(pool, job_id: str, token: str, messages, model: str, max_tokens: int) -> dict:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        await renew_lease(pool, job_id, token, attempt)
        try:
            return await router.complete(messages, model, max_tokens)
        except RetryableError as exc:
            if attempt == MAX_ATTEMPTS:
                raise
            state["retries"] += 1
            delay = min(2 ** (attempt - 1), 20) + random.random()
            log("all providers failed, retrying", job_id=job_id, error=str(exc)[:200],
                attempt=attempt, retry_in_s=round(delay, 1))
            await asyncio.sleep(delay)
    raise AssertionError("unreachable")


async def process(job_id: str, pool, producer: AIOKafkaProducer):
    token = uuid.uuid4().hex
    job = await pool.fetchrow(
        """
        UPDATE requests SET status = 'processing', started_at = now(), claim_token = $2,
            claims = claims + 1, lease_until = now() + make_interval(secs => $3)
        WHERE id = $1 AND status = 'queued'
        RETURNING tenant_id, prompt, model, max_tokens
        """,
        job_id, token, float(LEASE_S),
    )
    if job is None:
        log("skipping job (not queued: done, failed, or leased by another worker)", job_id=job_id)
        return

    state["current_job"] = job_id
    messages = [{"role": "user", "content": job["prompt"]}]
    try:
        out = await run_with_lease(
            pool, job_id, token,
            call_llm(pool, job_id, token, messages, job["model"], job["max_tokens"]))
        done = await pool.fetchval(
            """
            UPDATE requests SET status = 'done', result = $3, prompt_tokens = $4,
                completion_tokens = $5, latency_ms = $6, provider = $7, completed_at = now(),
                claim_token = NULL, lease_until = NULL
            WHERE id = $1 AND claim_token = $2
            RETURNING true
            """,
            job_id, token, out["content"], out["prompt_tokens"], out["completion_tokens"],
            out["latency_ms"], out["provider"],
        )
        if not done:
            raise LeaseLost(job_id)
        await r.set(make_key(job["tenant_id"], job["model"], messages, job["max_tokens"]),
                    json.dumps(out), ex=CACHE_TTL_S)
        state["processed"] += 1
        log("job done", job_id=job_id, provider=out["provider"], latency_ms=out["latency_ms"])
    except LeaseLost:
        state["lost_leases"] += 1
        log("lease lost; result discarded (job was reclaimed)", job_id=job_id)
    except (RetryableError, FatalError, Exception) as exc:  # noqa: BLE001 - all go to the DLQ
        error = str(exc)[:300] or repr(exc)[:300]
        failed = await pool.fetchval(
            """
            UPDATE requests SET status = 'failed', error = $3, completed_at = now(),
                claim_token = NULL, lease_until = NULL
            WHERE id = $1 AND claim_token = $2
            RETURNING true
            """,
            job_id, token, error,
        )
        if failed:
            dead = {"job_id": job_id, "tenant_id": job["tenant_id"], "error": error,
                    "failed_at": datetime.now(timezone.utc).isoformat()}
            await producer.send_and_wait(DLQ_TOPIC, json.dumps(dead).encode())
            state["failed"] += 1
            log("job sent to dead-letter topic", job_id=job_id, error=error)
    finally:
        state["current_job"] = None


async def heartbeat():
    while True:
        payload = state | {"last_seen": datetime.now(timezone.utc).isoformat()}
        try:
            await r.set(f"worker:{WORKER_ID}", json.dumps(payload), ex=15)
        except Exception as exc:  # noqa: BLE001
            log("heartbeat failed", error=repr(exc))
        await asyncio.sleep(5)


async def main():
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=3)
    producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BOOTSTRAP"], acks="all")
    await producer.start()
    consumer = AIOKafkaConsumer(
        TOPIC,
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP"],
        group_id=GROUP,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
        max_poll_interval_ms=900_000,
    )
    await consumer.start()
    hb = asyncio.create_task(heartbeat())

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    log("worker started", providers=[p.name for p in router.providers], lease_s=LEASE_S)
    try:
        while not stop.is_set():
            batch = await consumer.getmany(timeout_ms=1000, max_records=1)
            for _, messages in batch.items():
                for msg in messages:
                    try:
                        job_id = json.loads(msg.value)["job_id"]
                    except (ValueError, KeyError):
                        log("dropping malformed message", offset=msg.offset)
                    else:
                        await process(job_id, pool, producer)
                    await consumer.commit()
    finally:
        log("worker stopping")
        hb.cancel()
        await r.delete(f"worker:{WORKER_ID}")
        await consumer.stop()
        await producer.stop()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
