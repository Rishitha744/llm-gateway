import json

from aiokafka import AIOKafkaProducer

from app import config, store

producer: AIOKafkaProducer | None = None


async def start_producer():
    global producer
    producer = AIOKafkaProducer(bootstrap_servers=config.KAFKA_BOOTSTRAP, acks="all")
    await producer.start()


async def stop_producer():
    if producer:
        await producer.stop()


async def publish(job_id: str, tenant_id: int):
    """Publish a job ID and acknowledge it in the outbox (requests.published_at).

    The row is written before this is called, so a crash between the two steps
    leaves an unpublished row that the sweeper relays later (transactional outbox).
    """
    await send(job_id, tenant_id)
    await store.mark_published(job_id)


async def send(job_id: str, tenant_id: int):
    """Kafka write only; the caller is responsible for the outbox acknowledgement."""
    # Keyed by tenant so one tenant's jobs stay ordered on a single partition.
    message = json.dumps({"job_id": job_id}).encode()
    await producer.send_and_wait(config.JOBS_TOPIC, message, key=str(tenant_id).encode())


async def publish_dead_letter(payload: dict):
    await producer.send_and_wait(config.DLQ_TOPIC, json.dumps(payload).encode())


async def kafka_ok() -> bool:
    try:
        if producer is None:
            return False
        await producer.client.fetch_all_metadata()
        return True
    except Exception:
        return False
