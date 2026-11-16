"""Generate realistic traffic so the dashboards have something to show.

    python scripts/load_test.py --key gw_... --requests 60 --concurrency 6

Mixes repeated prompts (cache hits), unique prompts (model calls) and
bursts that exceed the tenant's quota (429s). Standard library only.
"""
import argparse
import json
import random
import threading
import time
import urllib.error
import urllib.request
from collections import Counter

PROMPTS = [
    "Summarize the CAP theorem in one sentence.",
    "Give me a one-line definition of a message queue.",
    "What does idempotent mean in an API? One sentence.",
    "Name three uses of Redis, comma separated.",
    "Explain exponential backoff in one sentence.",
]


def submit(base: str, key: str, prompt: str) -> int:
    req = urllib.request.Request(
        f"{base}/v1/jobs",
        data=json.dumps({"prompt": prompt, "max_tokens": 64}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--key", required=True)
    p.add_argument("--url", default="http://localhost:8080")
    p.add_argument("--requests", type=int, default=60)
    p.add_argument("--concurrency", type=int, default=6)
    p.add_argument("--unique-ratio", type=float, default=0.3, help="share of never-seen prompts")
    a = p.parse_args()

    counts: Counter = Counter()
    lock = threading.Lock()
    remaining = list(range(a.requests))

    def worker():
        while True:
            with lock:
                if not remaining:
                    return
                i = remaining.pop()
            if random.random() < a.unique_ratio:
                prompt = f"{random.choice(PROMPTS)} (variant {i}-{time.time_ns() % 10_000})"
            else:
                prompt = random.choice(PROMPTS)
            status = submit(a.url, a.key, prompt)
            with lock:
                counts[status] += 1

    started = time.time()
    threads = [threading.Thread(target=worker) for _ in range(a.concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"{a.requests} requests in {time.time() - started:.1f}s -> " +
          ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    print("200 = cache hit, 202 = queued for a worker, 429 = rate limited")


if __name__ == "__main__":
    main()
