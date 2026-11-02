import hashlib

from fastapi import Header, HTTPException

from app import db


async def get_tenant(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing API key")

    key = authorization.removeprefix("Bearer ").strip()
    key_hash = hashlib.sha256(key.encode()).hexdigest()

    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT t.id, t.name, t.rate_limit_per_min
            FROM api_keys k
            JOIN tenants t ON t.id = k.tenant_id
            WHERE k.key_hash = $1 AND k.is_active
            """,
            key_hash,
        )

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return dict(row)