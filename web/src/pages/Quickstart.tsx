import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, CodeBlock, PageHeader, Segmented } from "@/components/ui";

type Lang = "curl" | "python" | "node";

export default function Quickstart() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const [lang, setLang] = useState<Lang>("python");
  const base = window.location.origin;
  const model = me.data?.defaults.model ?? "llama3.2";

  const sync: Record<Lang, string> = {
    curl: `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer $GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    python: `import os
from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key=os.environ["GATEWAY_API_KEY"])

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}/v1", apiKey: process.env.GATEWAY_API_KEY });

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(resp.choices[0].message.content);`,
  };

  const asyncJobs: Record<Lang, string> = {
    curl: `# 1. submit (202 Accepted, or 200 on a cache hit)
#    Idempotency-Key makes a retried submit return the original job, not a duplicate.
JOB=$(curl -s ${base}/v1/jobs -H "Authorization: Bearer $GATEWAY_API_KEY" \\
  -H "Idempotency-Key: order-1234" \\
  -H "Content-Type: application/json" -d '{"prompt": "Summarize Kafka in one line"}' | jq -r .job_id)

# 2. poll until status is done or failed
curl -s ${base}/v1/jobs/$JOB -H "Authorization: Bearer $GATEWAY_API_KEY" | jq '{status, result}'`,
    python: `import os, time, httpx

gw = httpx.Client(base_url="${base}", headers={"Authorization": f"Bearer {os.environ['GATEWAY_API_KEY']}"})

# Idempotency-Key makes a retried submit return the original job, not a duplicate.
job = gw.post("/v1/jobs", json={"prompt": "Summarize Kafka in one line"},
              headers={"Idempotency-Key": "order-1234"}).json()
while (j := gw.get(f"/v1/jobs/{job['job_id']}").json())["status"] in ("queued", "processing"):
    time.sleep(0.5)
print(j["status"], j["result"])`,
    node: `const headers = { Authorization: \`Bearer \${process.env.GATEWAY_API_KEY}\`, "Content-Type": "application/json" };

// Idempotency-Key makes a retried submit return the original job, not a duplicate.
const { job_id } = await fetch("${base}/v1/jobs", {
  method: "POST", headers: { ...headers, "Idempotency-Key": "order-1234" }, body: JSON.stringify({ prompt: "Summarize Kafka in one line" }),
}).then((r) => r.json());

let job;
do {
  await new Promise((r) => setTimeout(r, 500));
  job = await fetch(\`${base}/v1/jobs/\${job_id}\`, { headers }).then((r) => r.json());
} while (job.status === "queued" || job.status === "processing");
console.log(job.status, job.result);`,
  };

  const streaming: Record<Lang, string> = {
    curl: `curl -sN ${base}/v1/chat/completions \\
  -H "Authorization: Bearer $GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "stream": true, "messages": [{"role": "user", "content": "Write a haiku"}]}'`,
    python: `stream = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Write a haiku"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`,
    node: `const stream = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Write a haiku" }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`,
  };

  const langs = [{ value: "python" as const, label: "Python" }, { value: "node" as const, label: "Node.js" }, { value: "curl" as const, label: "cURL" }];

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="Quickstart" description="The gateway speaks the OpenAI wire format, so most SDKs work by changing the base URL." actions={<Segmented value={lang} onChange={setLang} options={langs} />} />
      <Card>
        <CardHeader title="Synchronous completion" subtitle="POST /v1/chat/completions · blocks until the model answers" />
        <div className="px-5 pb-5"><CodeBlock code={sync[lang]} /></div>
      </Card>
      <Card>
        <CardHeader title="Streaming" subtitle="stream: true · server-sent events, same chunk format as OpenAI" />
        <div className="px-5 pb-5"><CodeBlock code={streaming[lang]} /></div>
      </Card>
      <Card>
        <CardHeader title="Async job" subtitle="POST /v1/jobs then GET /v1/jobs/{id} · best for long prompts and batch work" />
        <div className="px-5 pb-5"><CodeBlock code={asyncJobs[lang]} /></div>
      </Card>
      <Card>
        <CardHeader title="Response headers" subtitle="Returned on every authenticated call" />
        <div className="px-5 pb-5 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {[
                ["X-RateLimit-Limit / -Remaining / -Reset", "Your per-minute quota, what's left, and seconds until the window resets."],
                ["Retry-After", "Sent with 429 responses: seconds to wait before retrying."],
                ["X-Cache", "HIT when the response came from the tenant cache, otherwise MISS."],
                ["X-Request-ID", "Correlates your request with gateway logs. Pass your own to propagate it."],
                ["X-Gateway-Instance", "Which gateway replica served the request (nginx load-balances them)."],
                ["Idempotent-Replayed", "true when an Idempotency-Key matched an earlier submit and the original job was returned."],
              ].map(([h, d]) => (
                <tr key={h}><td className="py-2.5 pr-6 font-mono text-xs whitespace-nowrap align-top">{h}</td><td className="py-2.5 text-muted">{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
