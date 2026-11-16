import hashlib
import secrets

PREFIX_LEN = 10


def generate() -> tuple[str, str, str]:
    """Return (plaintext key, sha256 hash, display prefix)."""
    key = "gw_" + secrets.token_urlsafe(32)
    return key, hash_key(key), key[:PREFIX_LEN]


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()
