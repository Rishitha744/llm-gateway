import socket
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from app import db, jobs
from app.auth import get_tenant
from app.ratelimit import rate_limit

INSTANCE_ID = socket.gethostname()


class ChatRequest(BaseModel):
    prompt: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await jobs.start_producer()
    yield
    await jobs.stop_producer()
    await db.disconnect()


app = FastAPI(title="LLM Gateway", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "instance": INSTANCE_ID}


@app.get("/db-check")
async def db_check():
    async with db.pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM tenants")
    return {"instance": INSTANCE_ID, "tenants": count}


@app.post("/v1/jobs", status_code=202)
async def submit_job(req: ChatRequest, tenant: dict = Depends(rate_limit)):
    job_id = await jobs.enqueue(tenant["id"], req.prompt)
    return {"job_id": job_id, "status": "queued"}


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, tenant: dict = Depends(get_tenant)):
    job = await jobs.get_job(job_id)
    if job is None or int(job["tenant_id"]) != tenant["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "result": job.get("result"),
    }