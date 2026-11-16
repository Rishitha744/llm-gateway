import hmac

from fastapi import Header, HTTPException

from app import config, db, keys


async def get_tenant(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing API key")

    key_hash = keys.hash_key(authorization.removeprefix("Bearer ").strip())

    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT t.id, t.name, t.rate_limit_per_min,
                   k.id AS key_id, k.key_prefix, k.name AS key_name
            FROM api_keys k
            JOIN tenants t ON t.id = k.tenant_id
            WHERE k.key_hash = $1 AND k.is_active AND t.is_active
            """,
            key_hash,
        )
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid API key")
        # Throttled write: at most once a minute per key.
        await conn.execute(
            """
            UPDATE api_keys SET last_used_at = now()
            WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
            """,
            row["key_id"],
        )

    return dict(row)


async def require_admin(x_admin_token: str = Header(default="")):
    if not config.ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin API disabled (ADMIN_TOKEN not set)")
    if not hmac.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid admin token")
