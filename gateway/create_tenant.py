import hashlib
import secrets
import sys

name = sys.argv[1]
key = "gw_" + secrets.token_urlsafe(32)
key_hash = hashlib.sha256(key.encode()).hexdigest()

print("API KEY (save it now, it is never shown again):")
print(key)
print()
print("SQL to run:")
print(f"INSERT INTO tenants (name) VALUES ('{name}');")
print(
    "INSERT INTO api_keys (tenant_id, key_hash) "
    f"SELECT id, '{key_hash}' FROM tenants WHERE name = '{name}';"
)