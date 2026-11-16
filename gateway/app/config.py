import os
import socket

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ["REDIS_URL"]
KAFKA_BOOTSTRAP = os.environ["KAFKA_BOOTSTRAP"]

LLM_MODEL = os.environ["LLM_MODEL"]
# Models tenants may request. The first one is the default.
ALLOWED_MODELS = [
    m.strip() for m in os.environ.get("ALLOWED_MODELS", LLM_MODEL).split(",") if m.strip()
]
if LLM_MODEL not in ALLOWED_MODELS:
    ALLOWED_MODELS.insert(0, LLM_MODEL)

# Circuit breaker per upstream provider (state shared through Redis).
CB_THRESHOLD = int(os.environ.get("CB_THRESHOLD", "5"))
CB_COOLDOWN_S = float(os.environ.get("CB_COOLDOWN_S", "30"))
DEFAULT_MAX_TOKENS = int(os.environ.get("DEFAULT_MAX_TOKENS", "300"))
MAX_TOKENS_CAP = int(os.environ.get("MAX_TOKENS_CAP", "2048"))
MAX_PROMPT_CHARS = int(os.environ.get("MAX_PROMPT_CHARS", "16000"))
CACHE_TTL_S = int(os.environ.get("CACHE_TTL_S", "3600"))

# Admin API is disabled when no token is configured.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]

INSTANCE_ID = socket.gethostname()

JOBS_TOPIC = "jobs"
DLQ_TOPIC = "jobs-dlq"

# Reliability sweeper (runs on one gateway replica at a time).
SWEEP_INTERVAL_S = float(os.environ.get("SWEEP_INTERVAL_S", "10"))
OUTBOX_GRACE_S = int(os.environ.get("OUTBOX_GRACE_S", "5"))
MAX_CLAIMS = int(os.environ.get("MAX_CLAIMS", "3"))
# Re-publish jobs still queued this long after publication (lost/skipped message).
STALE_QUEUED_S = int(os.environ.get("STALE_QUEUED_S", "300"))
