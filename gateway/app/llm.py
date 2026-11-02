import os

import httpx

HF_URL = "https://router.huggingface.co/v1/chat/completions"

client = httpx.AsyncClient(timeout=60)


async def generate(prompt: str) -> str:
    resp = await client.post(
        HF_URL,
        headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"},
        json={
            "model": os.environ["LLM_MODEL"],
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 300,
        },
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]