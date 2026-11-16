from pathlib import Path

import asyncpg

from app import config

pool: asyncpg.Pool | None = None

SCHEMA = (Path(__file__).parent / "schema.sql").read_text()
MIGRATION_LOCK = 724_001


async def connect():
    global pool
    pool = await asyncpg.create_pool(config.DATABASE_URL, min_size=1, max_size=10)
    async with pool.acquire() as conn:
        # Serialize migrations across replicas.
        await conn.execute("SELECT pg_advisory_lock($1)", MIGRATION_LOCK)
        try:
            await conn.execute(SCHEMA)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", MIGRATION_LOCK)


async def disconnect():
    if pool:
        await pool.close()
