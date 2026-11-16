import hashlib
import json


def make_key(tenant_id: int, model: str, messages: list[dict], max_tokens: int) -> str:
    """Response-cache key, scoped per tenant. Shared so gateway and workers agree."""
    material = json.dumps([model, max_tokens, messages], separators=(",", ":"), sort_keys=True)
    return f"cache:{tenant_id}:{hashlib.sha256(material.encode()).hexdigest()}"
