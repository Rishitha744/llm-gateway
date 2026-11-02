import os

import asyncpg

pool = None


async def connect():
    global pool
    pool = await asyncpg.create_pool(
        os.environ["DATABASE_URL"],
        min_size=1,
        max_size=5,
    )


async def disconnect():
    if pool:
        await pool.close()