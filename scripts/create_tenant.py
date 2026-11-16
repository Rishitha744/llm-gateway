"""Create a tenant through the admin API and print its first API key.

    python scripts/create_tenant.py acme-corp --rate-limit 120

Reads ADMIN_TOKEN from the environment or ./.env. Standard library only.
"""
import argparse
import json
import os
import pathlib
import urllib.error
import urllib.request


def admin_token() -> str:
    if os.environ.get("ADMIN_TOKEN"):
        return os.environ["ADMIN_TOKEN"]
    env = pathlib.Path(__file__).resolve().parent.parent / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("ADMIN_TOKEN not set (env var or .env)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("name")
    p.add_argument("--rate-limit", type=int, default=60)
    p.add_argument("--url", default=os.environ.get("GATEWAY_URL", "http://localhost:8080"))
    a = p.parse_args()

    req = urllib.request.Request(
        f"{a.url}/admin/tenants",
        data=json.dumps({"name": a.name, "rate_limit_per_min": a.rate_limit}).encode(),
        headers={"Content-Type": "application/json", "X-Admin-Token": admin_token()},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{e.code}: {e.read().decode()}")

    print(f"Tenant '{body['tenant']['name']}' (id {body['tenant']['id']}) created.")
    print("API key (shown once, store it now):")
    print(body["api_key"]["key"])


if __name__ == "__main__":
    main()
