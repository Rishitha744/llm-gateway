import json
import os
import uuid

import redis.asyncio as redis
from aiokafka import AIOKafkaProducer

r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
producer = None

TOPIC = "jobs"
JOB_TTL = 86400


async def start_producer():
    global producer
    producer = AIOKafkaProducer(bootstrap_servers=os.environ["KAFKA_BOOTSTRAP"])
    await producer.start()


async def stop_producer():
    if producer:
        await producer.stop()


async def enqueue(tenant_id: int, prompt: str) -> str:
    job_id = uuid.uuid4().hex
    key = f"job:{job_id}"
    await r.hset(
        key,
        mapping={"tenant_id": tenant_id, "prompt": prompt, "status": "queued"},
    )
    await r.expire(key, JOB_TTL)

    message = json.dumps({"job_id": job_id}).encode()
    await producer.send_and_wait(TOPIC, message, key=str(tenant_id).encode())
    return job_id


async def get_job(job_id: str):
    data = await r.hgetall(f"job:{job_id}")
    return data or None