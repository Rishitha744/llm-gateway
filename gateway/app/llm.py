"""The gateway's handle on upstream model providers (failover + circuit breaking)."""
from app import config
from app.redis_client import r
from common.providers import FatalError, RetryableError, Router, load_providers

router = Router(load_providers(), r, threshold=config.CB_THRESHOLD, cooldown_s=config.CB_COOLDOWN_S)

__all__ = ["router", "FatalError", "RetryableError"]
