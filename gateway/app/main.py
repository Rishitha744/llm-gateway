import asyncio 
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config, db, jobs, llm, sweeper, system
from app.routes_admin import router as admin_router
from app.routes_api import router as api_router

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("gateway")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await jobs.start_producer()
    sweep = asyncio.create_task(sweeper.run_forever())
    yield
    sweep.cancel()
    await asyncio.gather(sweep, return_exceptions=True)
    await jobs.stop_producer()
    for provider in llm.router.providers:
        await provider.client.aclose()
    await db.disconnect()


app = FastAPI(
    title="LLM Gateway",
    version="1.0.0",
    description="Multi-tenant LLM gateway: API keys, rate limiting, response cache, "
    "Kafka-backed async jobs with retries and a dead-letter queue.",
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

if config.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Cache", "Idempotent-Replayed", "X-RateLimit-Limit",
                        "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    )


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Gateway-Instance"] = config.INSTANCE_ID
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms}"
    if not request.url.path.startswith("/health"):
        log.info(json.dumps({
            "msg": "request", "request_id": request_id, "method": request.method,
            "path": request.url.path, "status": response.status_code, "ms": elapsed_ms,
        }))
    return response


@app.get("/health", tags=["system"])
async def health():
    """Liveness: the process is up."""
    return {"status": "ok", "instance": config.INSTANCE_ID}


@app.get("/health/ready", tags=["system"])
async def ready():
    """Readiness: every hard dependency answers."""
    checks = await system.readiness()
    ok = all(c["ok"] for c in checks)
    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "instance": config.INSTANCE_ID,
                 "checks": checks},
    )


app.include_router(api_router)
app.include_router(admin_router)
