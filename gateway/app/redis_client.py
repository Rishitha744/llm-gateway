import redis.asyncio as redis

from app import config

r = redis.from_url(config.REDIS_URL, decode_responses=True)
