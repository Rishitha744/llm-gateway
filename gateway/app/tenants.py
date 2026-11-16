from app import db, keys

KEY_COLUMNS = "id, tenant_id, name, key_prefix, is_active, created_at, last_used_at, revoked_at"


def _iso(d: dict) -> dict:
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}


async def create_key(tenant_id: int, name: str) -> dict:
    plaintext, key_hash, prefix = keys.generate()
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO api_keys (tenant_id, key_hash, name, key_prefix)
            VALUES ($1, $2, $3, $4) RETURNING {KEY_COLUMNS}
            """,
            tenant_id, key_hash, name, prefix,
        )
    return _iso(dict(row)) | {"key": plaintext}


async def list_keys(tenant_id: int) -> list[dict]:
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {KEY_COLUMNS} FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
            tenant_id,
        )
    return [_iso(dict(r)) for r in rows]


async def revoke_key(key_id: int, tenant_id: int | None = None) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE api_keys SET is_active = FALSE, revoked_at = coalesce(revoked_at, now())
            WHERE id = $1 AND ($2::int IS NULL OR tenant_id = $2)
            RETURNING {KEY_COLUMNS}
            """,
            key_id, tenant_id,
        )
    return _iso(dict(row)) if row else None


async def list_tenants() -> list[dict]:
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.id, t.name, t.rate_limit_per_min, t.is_active, t.created_at,
                   count(k.id) FILTER (WHERE k.is_active) AS active_keys,
                   max(k.last_used_at) AS last_used_at,
                   (SELECT count(*) FROM requests r
                     WHERE r.tenant_id = t.id AND r.created_at >= now() - interval '24 hours')
                     AS requests_24h,
                   (SELECT count(*) FROM requests r
                     WHERE r.tenant_id = t.id AND r.status = 'failed'
                       AND r.created_at >= now() - interval '24 hours') AS failed_24h
            FROM tenants t LEFT JOIN api_keys k ON k.tenant_id = t.id
            GROUP BY t.id ORDER BY t.created_at
            """
        )
    return [_iso(dict(r)) for r in rows]


async def get_tenant(tenant_id: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, rate_limit_per_min, is_active, created_at FROM tenants WHERE id = $1",
            tenant_id,
        )
    return _iso(dict(row)) if row else None


async def create_tenant(name: str, rate_limit_per_min: int) -> dict | None:
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO tenants (name, rate_limit_per_min) VALUES ($1, $2)
            ON CONFLICT (name) DO NOTHING
            RETURNING id, name, rate_limit_per_min, is_active, created_at
            """,
            name, rate_limit_per_min,
        )
    return _iso(dict(row)) if row else None


async def update_tenant(tenant_id: int, rate_limit_per_min: int | None, is_active: bool | None):
    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE tenants SET
                rate_limit_per_min = coalesce($2, rate_limit_per_min),
                is_active = coalesce($3, is_active)
            WHERE id = $1
            RETURNING id, name, rate_limit_per_min, is_active, created_at
            """,
            tenant_id, rate_limit_per_min, is_active,
        )
    return _iso(dict(row)) if row else None
