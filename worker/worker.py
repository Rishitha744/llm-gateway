import asyncio
import json
import os
import random

import httpx
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

TOPIC = "jobs"
DLQ_TOPIC = "jobs-dlq"
GROUP = "workers"
MAX_ATTEMPTS = 4
RETRY_STATUS = {429, 500, 502, 503, 504}

r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
http = httpx.AsyncClient(timeout=120)


class RetryableError(Exception):
    pass


async def call_llm(prompt: str) -> str:
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = await http.post(
                os.environ["LLM_BASE_URL"] + "/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"},
                json={
                    "model": os.environ["LLM_MODEL"],
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 300,
                },
            )
            if resp.status_code in RETRY_STATUS:
                raise RetryableError(f"status {resp.status_code}")
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except (httpx.TransportError, RetryableError) as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            delay = min(2**attempt, 20) + random.random()
            print(f"llm call failed ({exc!r}), retry {attempt + 1} in {delay:.1f}s", flush=True)
            await asyncio.sleep(delay)


async def process(job_id: str, producer: AIOKafkaProducer):
    key = f"job:{job_id}"
    job = await r.hgetall(key)
    if not job:
        return
    await r.hset(key, "status", "processing")
    try:
        answer = await call_llm(job["prompt"])
        await r.hset(key, mapping={"status": "done", "result": answer})
    except Exception as exc:
        error = repr(exc)[:200]
        await r.hset(key, mapping={"status": "failed", "error": error})
        dead = {"job_id": job_id, "tenant_id": job.get("tenant_id"), "error": error}
        await producer.send_and_wait(DLQ_TOPIC, json.dumps(dead).encode())
        print(f"job {job_id} sent to dead-letter topic", flush=True)


async def main():
    producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BOOTSTRAP"])
    await producer.start()
    consumer = AIOKafkaConsumer(
        TOPIC,
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP"],
        group_id=GROUP,
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    await consumer.start()
    print("worker started", flush=True)
    try:
        async for msg in consumer:
            job_id = json.loads(msg.value)["job_id"]
            await process(job_id, producer)
            await consumer.commit()
            print(f"finished job {job_id}", flush=True)
    finally:
        await consumer.stop()
        await producer.stop()


asyncio.run(main())