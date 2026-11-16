"""Operator API (authenticated with X-Admin-Token)."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app import jobs, store, system, tenants
from app.auth import require_admin
from app.schemas import CreateKey, CreateTenant, UpdateTenant

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

RangeKey = Literal["1h", "24h", "7d"]
StatusFilter = Literal["queued", "processing", "done", "failed", "cached"]


@router.get("/whoami")
async def whoami():
    return {"role": "admin"}


@router.get("/overview")
async def overview(range: RangeKey = "24h"):
    data = await store.usage(None, range)
    data["models"] = await store.model_breakdown(None, range)
    data["tenants"] = await tenants.list_tenants()
    data["queue"] = await store.queue_depth()
    return data


@router.get("/tenants")
async def list_tenants():
    return {"data": await tenants.list_tenants()}


@router.post("/tenants", status_code=201)
async def create_tenant(body: CreateTenant):
    tenant = await tenants.create_tenant(body.name.strip(), body.rate_limit_per_min)
    if tenant is None:
        raise HTTPException(status_code=409, detail="A tenant with that name already exists")
    key = await tenants.create_key(tenant["id"], "default")
    return {"tenant": tenant, "api_key": key}


@router.get("/tenants/{tenant_id}")
async def get_tenant(tenant_id: int, range: RangeKey = "24h"):
    tenant = await tenants.get_tenant(tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "tenant": tenant,
        "keys": await tenants.list_keys(tenant_id),
        "usage": await store.usage([tenant_id], range),
    }


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: int, body: UpdateTenant):
    tenant = await tenants.update_tenant(tenant_id, body.rate_limit_per_min, body.is_active)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


@router.post("/tenants/{tenant_id}/keys", status_code=201)
async def create_key(tenant_id: int, body: CreateKey):
    if await tenants.get_tenant(tenant_id) is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return await tenants.create_key(tenant_id, body.name)


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: int):
    key = await tenants.revoke_key(key_id)
    if key is None:
        raise HTTPException(status_code=404, detail="Key not found")
    return key


@router.get("/jobs")
async def list_jobs(
    tenant_id: int | None = None,
    status: StatusFilter | None = None,
    q: str | None = Query(default=None, max_length=200),
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    items = await store.list_requests(
        tenant_id=tenant_id, status=status, q=q, before=before, limit=limit
    )
    next_cursor = items[-1]["created_at"] if len(items) == limit else None
    return {"data": items, "next_cursor": next_cursor}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = await store.get_request(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/retry", status_code=202)
async def retry_job(job_id: str):
    job = await store.get_request(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not await store.requeue(job_id):
        raise HTTPException(status_code=409, detail="Only failed async jobs can be retried")
    try:
        await jobs.publish(job_id, job["tenant_id"])
    except Exception:  # noqa: BLE001 - left unpublished; the sweeper relays it
        pass
    return {"job_id": job_id, "status": "queued"}


@router.get("/system")
async def system_status():
    return await system.snapshot()
