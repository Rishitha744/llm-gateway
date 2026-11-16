/**
 * In-browser stand-in for the gateway API, used by "demo mode" so the console
 * can be explored (or hosted statically) without the backend stack.
 * It implements the same routes and response shapes as the real gateway.
 */
import type { ApiKey, Job, JobStatus, Tenant, UsagePoint } from "./types";

const MODEL = "llama3.2";
const MODELS = [MODEL, "qwen2.5:7b"];
const RANGES = { "1h": [3600, 300], "24h": [86400, 3600], "7d": [7 * 86400, 6 * 3600] } as const;

const PROMPTS = [
  "Summarize the key risks in our Q3 vendor contract in 3 bullets.",
  "Write a friendly onboarding email for a new enterprise customer.",
  "Classify this support ticket: 'Checkout page times out on mobile'.",
  "Translate 'Your order has shipped' into Spanish, French and German.",
  "Extract all dates and amounts from this invoice text.",
  "Generate 5 SEO titles for a blog post about vector databases.",
  "Explain the difference between at-least-once and exactly-once delivery.",
  "Rewrite this paragraph to be more concise and professional.",
  "What are three ways to reduce p95 latency in a Python API?",
  "Draft a SQL query that returns the top 10 customers by revenue.",
];

const ANSWERS = [
  "Here's a concise breakdown:\n\n1. **Liability cap** is set at 1x annual fees, below the industry norm of 2x.\n2. **Auto-renewal** triggers 90 days before term end with no price ceiling.\n3. **Data residency** is not specified, which conflicts with your EU obligations.",
  "Sure! The key idea is that the gateway sits between your applications and model providers, so it can enforce quotas, cache repeated prompts and queue long-running work without each client re-implementing that logic.",
  "Category: **Bug / Performance**\nPriority: High\nComponent: Checkout (mobile web)\nSuggested owner: Payments team",
  "At-least-once delivery guarantees a message is processed one or more times; consumers must be idempotent. Exactly-once additionally guarantees no duplicates, typically via transactional writes or idempotency keys that the broker and sink coordinate on.",
  "1. Cache hot reads close to the handler.\n2. Move slow I/O off the request path into a queue.\n3. Use connection pooling and set tight upstream timeouts with retries and jitter.",
];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const hex = (n = 32) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MockKey extends ApiKey {}
interface DB {
  tenants: Tenant[];
  keys: MockKey[];
  jobs: Job[];
  rateLimited: Map<number, number>; // 5-min slot epoch -> count (per tenant id folded into key)
  nextTenant: number;
  nextKey: number;
  cache: Map<string, { content: string; pt: number; ct: number }>;
  bootedAt: number;
}

function makeJob(tenant: Tenant, created: number, opts: Partial<Job> = {}): Job {
  const cached = opts.cached ?? Math.random() < 0.32;
  const failed = !cached && Math.random() < 0.025;
  const latency = cached ? Math.round(rnd(2, 9)) : Math.round(Math.max(180, rnd(500, 2200) + (Math.random() < 0.08 ? rnd(1500, 5000) : 0)));
  const queue = cached ? 0 : Math.round(rnd(8, 120));
  const pt = Math.round(rnd(20, 180));
  const ct = Math.round(rnd(60, 300));
  const status: JobStatus = failed ? "failed" : "done";
  const kindRoll = Math.random();
  const kind: Job["kind"] = kindRoll < 0.6 ? "async" : kindRoll < 0.8 ? "stream" : "sync";
  const reclaimed = !cached && !failed && Math.random() < 0.01;
  return {
    id: hex(),
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    kind,
    status,
    cached,
    model: Math.random() < 0.85 ? MODEL : MODELS[1],
    max_tokens: 300,
    prompt: pick(PROMPTS),
    result: failed ? null : pick(ANSWERS),
    error: failed ? pick(["RetryableError('upstream status 503')", "ReadTimeout('timed out')", "RetryableError('upstream status 429')"]) : null,
    attempts: cached ? 0 : failed ? 4 : Math.random() < 0.06 ? 2 : 1,
    prompt_tokens: failed ? null : pt,
    completion_tokens: failed ? null : ct,
    latency_ms: failed ? null : latency,
    queue_ms: queue,
    total_ms: queue + latency,
    created_at: iso(created),
    started_at: iso(created + queue),
    completed_at: iso(created + queue + latency),
    provider: failed ? null : Math.random() < 0.94 ? "ollama-local" : "openai-fallback",
    ttft_ms: kind === "stream" && !failed ? Math.round(cached ? latency : rnd(180, 650)) : null,
    claims: cached || kind !== "async" ? 0 : reclaimed ? 2 : 1,
    idempotency_key: kind === "async" && Math.random() < 0.3 ? "order-" + hex(6) : null,
    ...opts,
  };
}

function seed(): DB {
  const now = Date.now();
  const tenants: Tenant[] = [
    { id: 1, name: "acme-corp", rate_limit_per_min: 120, is_active: true, created_at: iso(now - 40 * 86400e3) },
    { id: 2, name: "globex", rate_limit_per_min: 60, is_active: true, created_at: iso(now - 25 * 86400e3) },
    { id: 3, name: "initech-labs", rate_limit_per_min: 30, is_active: true, created_at: iso(now - 9 * 86400e3) },
    { id: 4, name: "umbrella-sandbox", rate_limit_per_min: 10, is_active: false, created_at: iso(now - 4 * 86400e3) },
  ];
  const keys: MockKey[] = [
    { id: 1, tenant_id: 1, name: "production", key_prefix: "gw_Xk29aQf", is_active: true, created_at: iso(now - 40 * 86400e3), last_used_at: iso(now - 20e3), revoked_at: null },
    { id: 2, tenant_id: 1, name: "ci-pipeline", key_prefix: "gw_p0Lm3Rt", is_active: true, created_at: iso(now - 12 * 86400e3), last_used_at: iso(now - 3600e3), revoked_at: null },
    { id: 3, tenant_id: 1, name: "old-laptop", key_prefix: "gw_Qa81zzN", is_active: false, created_at: iso(now - 30 * 86400e3), last_used_at: iso(now - 15 * 86400e3), revoked_at: iso(now - 14 * 86400e3) },
    { id: 4, tenant_id: 2, name: "default", key_prefix: "gw_G7hhe2W", is_active: true, created_at: iso(now - 25 * 86400e3), last_used_at: iso(now - 300e3), revoked_at: null },
    { id: 5, tenant_id: 3, name: "default", key_prefix: "gw_iT3cHx0", is_active: true, created_at: iso(now - 9 * 86400e3), last_used_at: iso(now - 7200e3), revoked_at: null },
    { id: 6, tenant_id: 4, name: "default", key_prefix: "gw_uMbR4ll", is_active: true, created_at: iso(now - 4 * 86400e3), last_used_at: null, revoked_at: null },
  ];
  const weights = [0.55, 0.3, 0.15];
  const jobs: Job[] = [];
  const rateLimited = new Map<number, number>();
  // ~7 days of traffic with a daily cycle.
  for (let t = now - 7 * 86400e3; t < now; t += 5 * 60e3) {
    const hour = new Date(t).getHours();
    const daily = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2));
    const recent = t > now - 3600e3 ? 1.6 : 1;
    const n = Math.round(rnd(0, 6) * daily * recent);
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const tenant = r < weights[0] ? tenants[0] : r < weights[0] + weights[1] ? tenants[1] : tenants[2];
      jobs.push(makeJob(tenant, t + rnd(0, 5 * 60e3)));
    }
    if (Math.random() < 0.06 * daily) {
      const slot = Math.floor(t / 300e3) * 300;
      rateLimited.set(slot * 10 + pick([1, 2, 3]), Math.round(rnd(2, 25)));
    }
  }
  jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { tenants, keys, jobs, rateLimited, nextTenant: 5, nextKey: 7, cache: new Map(), bootedAt: now - 3 * 86400e3 - 4123e3 };
}

let db: DB | null = null;
const getDb = () => (db ??= seed());
const ME_TENANT = 1;
const ME_KEY = 1;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": hex(16), "X-Gateway-Instance": pick(["gateway-1", "gateway-2"]), ...headers },
  });
}

function pct(xs: number[], p: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo));
}

function agg(jobs: Job[], rl: number) {
  const live = jobs.filter((j) => j.status === "done" && !j.cached).map((j) => j.latency_ms!);
  const total = jobs.length;
  const cached = jobs.filter((j) => j.cached).length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const sum = (f: (j: Job) => number) => jobs.reduce((a, j) => a + f(j), 0);
  return {
    total,
    cached,
    failed,
    succeeded: jobs.filter((j) => j.status === "done").length,
    in_flight: jobs.filter((j) => j.status === "queued" || j.status === "processing").length,
    prompt_tokens: sum((j) => (j.cached ? 0 : j.prompt_tokens ?? 0)),
    completion_tokens: sum((j) => (j.cached ? 0 : j.completion_tokens ?? 0)),
    tokens_saved: sum((j) => (j.cached ? (j.prompt_tokens ?? 0) + (j.completion_tokens ?? 0) : 0)),
    p50_ms: pct(live, 0.5),
    p95_ms: pct(live, 0.95),
    ttft_p50_ms: pct(jobs.filter((j) => j.ttft_ms != null && !j.cached).map((j) => j.ttft_ms!), 0.5),
    rate_limited: rl,
  };
}

function usage(tenantIds: number[], range: keyof typeof RANGES) {
  const d = getDb();
  const [span, bucket] = RANGES[range];
  const nowS = Math.floor(Date.now() / 1000);
  const first = Math.floor((nowS - span) / bucket) * bucket + bucket;
  const inScope = d.jobs.filter((j) => tenantIds.includes(j.tenant_id) && Date.parse(j.created_at) / 1000 >= first);
  const rlBy = new Map<number, number>();
  for (const [k, v] of d.rateLimited) {
    const slot = Math.floor(k / 10);
    const tid = k % 10;
    if (!tenantIds.includes(tid) || slot < first) continue;
    const b = Math.floor(slot / bucket) * bucket;
    rlBy.set(b, (rlBy.get(b) ?? 0) + v);
  }
  const byBucket = new Map<number, Job[]>();
  for (const j of inScope) {
    const b = Math.floor(Date.parse(j.created_at) / 1000 / bucket) * bucket;
    (byBucket.get(b) ?? byBucket.set(b, []).get(b)!).push(j);
  }
  const series: UsagePoint[] = [];
  for (let b = first; b <= nowS; b += bucket) series.push({ t: iso(b * 1000), ...agg(byBucket.get(b) ?? [], rlBy.get(b) ?? 0) });
  const s = agg(inScope, [...rlBy.values()].reduce((a, v) => a + v, 0));
  const models = MODELS.map((m) => {
    const js = inScope.filter((j) => j.model === m);
    return { model: m, total: js.length, tokens: js.reduce((a, j) => a + (j.cached ? 0 : (j.prompt_tokens ?? 0) + (j.completion_tokens ?? 0)), 0) };
  }).filter((m) => m.total);
  return {
    range,
    bucket_seconds: bucket,
    summary: { ...s, cache_hit_rate: s.total ? s.cached / s.total : 0, error_rate: s.total ? s.failed / s.total : 0 },
    series,
    models,
  };
}

function listJobs(url: URL, tenantId: number | null) {
  const d = getDb();
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.toLowerCase();
  const before = url.searchParams.get("before");
  const tid = tenantId ?? (url.searchParams.get("tenant_id") ? Number(url.searchParams.get("tenant_id")) : null);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const items = d.jobs
    .filter((j) => (tid === null || j.tenant_id === tid) &&
      (!status || j.status === status || (status === "cached" && j.cached)) &&
      (!q || j.prompt.toLowerCase().includes(q) || j.id === q) &&
      (!before || j.created_at < before))
    .slice(0, limit);
  return { data: items, next_cursor: items.length === limit ? items[items.length - 1].created_at : null };
}

function tenantRows() {
  const d = getDb();
  const since = Date.now() - 86400e3;
  return d.tenants.map((t) => {
    const keys = d.keys.filter((k) => k.tenant_id === t.id);
    const recent = d.jobs.filter((j) => j.tenant_id === t.id && Date.parse(j.created_at) >= since);
    return {
      ...t,
      active_keys: keys.filter((k) => k.is_active).length,
      last_used_at: keys.map((k) => k.last_used_at).filter(Boolean).sort().pop() ?? null,
      requests_24h: recent.length,
      failed_24h: recent.filter((j) => j.status === "failed").length,
    };
  });
}

function newKey(tenantId: number, name: string): ApiKey {
  const d = getDb();
  const full = "gw_" + btoa(hex(32)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 43);
  const k: MockKey = { id: d.nextKey++, tenant_id: tenantId, name, key_prefix: full.slice(0, 10), is_active: true, created_at: iso(Date.now()), last_used_at: null, revoked_at: null };
  d.keys.unshift(k);
  return { ...k, key: full };
}

function simulate(job: Job) {
  const fail = /fail|error/i.test(job.prompt);
  setTimeout(() => {
    job.status = "processing";
    job.started_at = iso(Date.now());
    job.queue_ms = Date.now() - Date.parse(job.created_at);
    job.attempts = 1;
  }, rnd(250, 600));
  const total = rnd(1400, 3200);
  if (fail) {
    [1, 2, 3].forEach((n) => setTimeout(() => (job.attempts = n + 1), total * (0.4 + n * 0.2)));
  }
  setTimeout(() => {
    const now = Date.now();
    job.completed_at = iso(now);
    job.total_ms = now - Date.parse(job.created_at);
    if (fail) {
      job.status = "failed";
      job.error = "RetryableError('upstream status 503')";
      return;
    }
    const content = answerFor(job.prompt);
    job.status = "done";
    job.result = content;
    job.provider = "ollama-local";
    job.claims = 1;
    job.latency_ms = now - Date.parse(job.started_at!);
    job.prompt_tokens = Math.ceil(job.prompt.length / 4);
    job.completion_tokens = Math.ceil(content.length / 4);
    getDb().cache.set(cacheKey(job), { content, pt: job.prompt_tokens, ct: job.completion_tokens });
  }, total + (fail ? 2500 : 0));
}

function answerFor(prompt: string) {
  if (/haiku|poem/i.test(prompt)) return "Requests flow like streams,\nqueued in patient partitions,\nanswers bloom on time.";
  if (/joke/i.test(prompt)) return "Why did the request go to therapy? It had too many unresolved promises.";
  return pick(ANSWERS);
}

const cacheKey = (j: { tenant_id: number; model: string; max_tokens: number; prompt: string }) => `${j.tenant_id}|${j.model}|${j.max_tokens}|${j.prompt}`;

let minuteWindow = 0;
let minuteCount = 0;
function limit(): Record<string, string> | Response {
  const d = getDb();
  const lim = d.tenants.find((t) => t.id === ME_TENANT)!.rate_limit_per_min;
  const w = Math.floor(Date.now() / 60000);
  if (w !== minuteWindow) {
    minuteWindow = w;
    minuteCount = Math.round(rnd(4, 20));
  }
  minuteCount++;
  const reset = String(60 - Math.floor((Date.now() / 1000) % 60));
  const h = { "X-RateLimit-Limit": String(lim), "X-RateLimit-Remaining": String(Math.max(0, lim - minuteCount)), "X-RateLimit-Reset": reset };
  if (minuteCount > lim) {
    const slot = Math.floor(Date.now() / 300e3) * 300;
    d.rateLimited.set(slot * 10 + ME_TENANT, (d.rateLimited.get(slot * 10 + ME_TENANT) ?? 0) + 1);
    return json(429, { detail: "Rate limit exceeded" }, { ...h, "Retry-After": reset });
  }
  return h;
}

export async function mockFetch(path: string, init: RequestInit): Promise<Response> {
  await sleep(rnd(60, 220));
  const d = getDb();
  const url = new URL(path, "http://demo.local");
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const p = url.pathname;
  const range = (url.searchParams.get("range") ?? "24h") as keyof typeof RANGES;
  let m: RegExpMatchArray | null;

  // ---- tenant API
  if (p === "/v1/me") {
    const t = d.tenants.find((x) => x.id === ME_TENANT)!;
    return json(200, {
      tenant: { id: t.id, name: t.name },
      key: { id: ME_KEY, name: "production", prefix: "gw_Xk29aQf" },
      rate_limit: { per_minute: t.rate_limit_per_min, used_this_minute: Math.floor(Date.now() / 60000) === minuteWindow ? minuteCount : Math.round(rnd(3, 18)) },
      defaults: { model: MODEL, max_tokens: 300, max_tokens_cap: 2048, cache_ttl_s: 3600 },
    });
  }
  if (p === "/v1/models") return json(200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", owned_by: "gateway" })) });
  if (p === "/v1/usage") return json(200, usage([ME_TENANT], range));
  if (p === "/v1/jobs" && method === "GET") return json(200, listJobs(url, ME_TENANT));
  if (p === "/v1/jobs" && method === "POST") {
    const h = limit();
    if (h instanceof Response) return h;
    const t = d.tenants.find((x) => x.id === ME_TENANT)!;
    const base = { tenant_id: t.id, model: body.model ?? MODEL, max_tokens: body.max_tokens ?? 300, prompt: String(body.prompt ?? "") };
    const idem = new Headers(init.headers).get("Idempotency-Key");
    const prior = idem ? d.jobs.find((j) => j.tenant_id === t.id && j.idempotency_key === idem) : undefined;
    if (prior) {
      if (prior.prompt !== base.prompt || prior.model !== base.model || prior.max_tokens !== base.max_tokens)
        return json(422, { detail: "Idempotency-Key was already used with a different request" }, h);
      return json(200, { job_id: prior.id, status: prior.status, cached: prior.cached }, { ...h, "Idempotent-Replayed": "true" });
    }
    const hit = d.cache.get(cacheKey(base));
    const now = Date.now();
    if (hit) {
      const job = makeJob(t, now, { ...base, idempotency_key: idem, provider: "ollama-local", ttft_ms: null, claims: 0, kind: "async", cached: true, status: "done", result: hit.content, prompt_tokens: hit.pt, completion_tokens: hit.ct, latency_ms: 3, queue_ms: 0, total_ms: 3, attempts: 0, error: null });
      d.jobs.unshift(job);
      return json(200, { job_id: job.id, status: "done", cached: true }, { ...h, "X-Cache": "HIT" });
    }
    const job: Job = { ...makeJob(t, now, base), kind: "async", cached: false, status: "queued", result: null, error: null, attempts: 0, prompt_tokens: null, completion_tokens: null, latency_ms: null, queue_ms: null, total_ms: null, started_at: null, completed_at: null, provider: null, ttft_ms: null, claims: 0, idempotency_key: idem, ...base };
    d.jobs.unshift(job);
    simulate(job);
    return json(202, { job_id: job.id, status: "queued", cached: false }, { ...h, "X-Cache": "MISS" });
  }
  if ((m = p.match(/^\/v1\/jobs\/(\w+)$/))) {
    const j = d.jobs.find((x) => x.id === m![1] && x.tenant_id === ME_TENANT);
    return j ? json(200, { ...j }) : json(404, { detail: "Job not found" });
  }
  if (p === "/v1/chat/completions") {
    const h = limit();
    if (h instanceof Response) return h;
    const t = d.tenants.find((x) => x.id === ME_TENANT)!;
    const msgs = body.messages as { role: string; content: string }[];
    const prompt = msgs.length === 1 ? msgs[0].content : msgs.map((x) => `[${x.role}] ${x.content}`).join("\n\n");
    const base = { tenant_id: t.id, model: body.model ?? MODEL, max_tokens: body.max_tokens ?? 300, prompt };
    const hit = d.cache.get(cacheKey(base));
    if (body.stream) return mockStream(t, base, hit, h);
    const latency = hit ? 3 : Math.round(rnd(700, 1800));
    if (!hit) await sleep(latency);
    const content = hit?.content ?? answerFor(prompt);
    const pt = hit?.pt ?? Math.ceil(prompt.length / 4);
    const ct = hit?.ct ?? Math.ceil(content.length / 4);
    if (!hit) d.cache.set(cacheKey(base), { content, pt, ct });
    const id = hex();
    d.jobs.unshift(makeJob(t, Date.now() - latency, { ...base, id, kind: "sync", cached: !!hit, status: "done", result: content, prompt_tokens: pt, completion_tokens: ct, latency_ms: latency, queue_ms: 0, total_ms: latency, attempts: hit ? 0 : 1, error: null, provider: "ollama-local", ttft_ms: null, claims: 0, idempotency_key: null }));
    return json(200, {
      id: `chatcmpl-${id}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: base.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
      x_gateway: { cached: !!hit, request_id: id, provider: "ollama-local" },
    }, { ...h, "X-Cache": hit ? "HIT" : "MISS" });
  }
  if (p === "/v1/keys" && method === "GET") return json(200, { data: d.keys.filter((k) => k.tenant_id === ME_TENANT), current_key_id: ME_KEY });
  if (p === "/v1/keys" && method === "POST") return json(201, newKey(ME_TENANT, body.name ?? "default"));
  if ((m = p.match(/^\/v1\/keys\/(\d+)$/)) && method === "DELETE") {
    const id = Number(m[1]);
    if (id === ME_KEY) return json(409, { detail: "Cannot revoke the key used for this request" });
    const k = d.keys.find((x) => x.id === id && x.tenant_id === ME_TENANT);
    if (!k) return json(404, { detail: "Key not found" });
    Object.assign(k, { is_active: false, revoked_at: k.revoked_at ?? iso(Date.now()) });
    return json(200, k);
  }

  // ---- admin API
  if (p === "/admin/whoami") return json(200, { role: "admin" });
  if (p === "/admin/overview") {
    const queued = d.jobs.filter((j) => j.status === "queued").length;
    const processing = d.jobs.filter((j) => j.status === "processing").length;
    return json(200, { ...usage(d.tenants.map((t) => t.id), range), tenants: tenantRows(), queue: { queued, processing, oldest_queued_at: null } });
  }
  if (p === "/admin/tenants" && method === "GET") return json(200, { data: tenantRows() });
  if (p === "/admin/tenants" && method === "POST") {
    if (d.tenants.some((t) => t.name === body.name)) return json(409, { detail: "A tenant with that name already exists" });
    const t: Tenant = { id: d.nextTenant++, name: body.name, rate_limit_per_min: body.rate_limit_per_min ?? 60, is_active: true, created_at: iso(Date.now()) };
    d.tenants.push(t);
    return json(201, { tenant: t, api_key: newKey(t.id, "default") });
  }
  if ((m = p.match(/^\/admin\/tenants\/(\d+)$/))) {
    const t = d.tenants.find((x) => x.id === Number(m![1]));
    if (!t) return json(404, { detail: "Tenant not found" });
    if (method === "PATCH") {
      if (body.rate_limit_per_min != null) t.rate_limit_per_min = body.rate_limit_per_min;
      if (body.is_active != null) t.is_active = body.is_active;
      return json(200, t);
    }
    return json(200, { tenant: t, keys: d.keys.filter((k) => k.tenant_id === t.id), usage: usage([t.id], range) });
  }
  if ((m = p.match(/^\/admin\/tenants\/(\d+)\/keys$/))) return json(201, newKey(Number(m[1]), body.name ?? "default"));
  if ((m = p.match(/^\/admin\/keys\/(\d+)$/))) {
    const k = d.keys.find((x) => x.id === Number(m![1]));
    if (!k) return json(404, { detail: "Key not found" });
    Object.assign(k, { is_active: false, revoked_at: k.revoked_at ?? iso(Date.now()) });
    return json(200, k);
  }
  if (p === "/admin/jobs") return json(200, listJobs(url, null));
  if ((m = p.match(/^\/admin\/jobs\/(\w+)\/retry$/))) {
    const j = d.jobs.find((x) => x.id === m![1]);
    if (!j) return json(404, { detail: "Job not found" });
    if (j.status !== "failed" || j.kind !== "async") return json(409, { detail: "Only failed async jobs can be retried" });
    Object.assign(j, { status: "queued", error: null, started_at: null, completed_at: null, latency_ms: null, prompt: j.prompt.replace(/fail|error/gi, "retry") });
    simulate(j);
    return json(202, { job_id: j.id, status: "queued" });
  }
  if ((m = p.match(/^\/admin\/jobs\/(\w+)$/))) {
    const j = d.jobs.find((x) => x.id === m![1]);
    return j ? json(200, { ...j }) : json(404, { detail: "Job not found" });
  }
  if (p === "/admin/system") {
    const now = Date.now();
    const processing = d.jobs.filter((j) => j.status === "processing");
    return json(200, {
      instance: "gateway-1",
      uptime_s: Math.floor((now - d.bootedAt) / 1000),
      dependencies: [
        { name: "postgres", ok: true, latency_ms: +rnd(0.6, 2.1).toFixed(1), error: null },
        { name: "redis", ok: true, latency_ms: +rnd(0.2, 0.9).toFixed(1), error: null },
        { name: "kafka", ok: true, latency_ms: +rnd(1.5, 6).toFixed(1), error: null },
        { name: "llm_upstream", ok: true, latency_ms: +rnd(4, 18).toFixed(1), error: null },
      ],
      providers: [
        { name: "ollama-local", base_url: "http://host.docker.internal:11434/v1", models: null, reachable: true, latency_ms: +rnd(4, 18).toFixed(1), circuit: "closed", failures: 0, trips: 2, open_until: null },
        { name: "openai-fallback", base_url: "https://api.openai.com/v1", models: { "llama3.2": "gpt-4o-mini", "qwen2.5:7b": "gpt-4o-mini" }, reachable: true, latency_ms: +rnd(60, 140).toFixed(1), circuit: "closed", failures: 1, trips: 0, open_until: null },
      ],
      sweeper: { last_run: iso(now - rnd(500, 9000)), leader: "gateway-2", interval_s: 10, relayed: 3, republished_stale: 1, reclaimed: 4, poisoned: 1, max_claims: 3 },
      workers: ["worker-1", "worker-2"].map((id, i) => ({
        id: `llm-gateway-${id}`, started_at: iso(d.bootedAt + i * 1000), last_seen: iso(now - rnd(200, 4800)),
        processed: 4120 + i * 377, failed: 41 + i * 9, retries: 133 + i * 17, lost_leases: i, current_job: processing[i]?.id ?? null,
      })),
      queue: { queued: d.jobs.filter((j) => j.status === "queued").length, processing: processing.length, oldest_queued_at: null, unpublished: 0, expired_leases: 0 },
      config: { llm_base_url: "http://host.docker.internal:11434/v1", default_model: MODEL, models: MODELS, cache_ttl_s: 3600, max_tokens_cap: 2048 },
    });
  }
  if (p === "/health/ready") return json(200, { status: "ok" });
  return json(404, { detail: "Not found (demo)" });
}

/** Server-sent events, chunked like the real gateway's stream. */
function mockStream(
  t: Tenant,
  base: { tenant_id: number; model: string; max_tokens: number; prompt: string },
  hit: { content: string; pt: number; ct: number } | undefined,
  headers: Record<string, string>,
) {
  const d = getDb();
  const id = hex();
  const content = hit?.content ?? answerFor(base.prompt);
  const pt = hit?.pt ?? Math.ceil(base.prompt.length / 4);
  const ct = hit?.ct ?? Math.ceil(content.length / 4);
  const started = Date.now();
  const enc = new TextEncoder();
  const frame = (o: unknown) => enc.encode("data: " + JSON.stringify(o) + "\n\n");
  const chunk = (delta: object, finish: string | null = null) =>
    frame({ id: "chatcmpl-" + id, object: "chat.completion.chunk", model: base.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  const pieces = hit ? [content] : content.match(/\S+\s*|\s+/g) ?? [content];
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      ctrl.enqueue(chunk({ role: "assistant" }));
      if (!hit) await sleep(rnd(200, 450));
      const ttft = Date.now() - started;
      for (const p of pieces) {
        ctrl.enqueue(chunk({ content: p }));
        if (!hit) await sleep(rnd(25, 70));
      }
      ctrl.enqueue(chunk({}, "stop"));
      ctrl.enqueue(frame({ choices: [], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct }, x_gateway: { cached: !!hit, request_id: id, provider: "ollama-local", ttft_ms: ttft } }));
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctrl.close();
      const latency = Date.now() - started;
      if (!hit) d.cache.set(cacheKey(base), { content, pt, ct });
      d.jobs.unshift(makeJob(t, started, { ...base, id, kind: "stream", cached: !!hit, status: "done", result: content, prompt_tokens: pt, completion_tokens: ct, latency_ms: latency, queue_ms: 0, total_ms: latency, attempts: hit ? 0 : 1, error: null, provider: "ollama-local", ttft_ms: ttft, claims: 0, idempotency_key: null }));
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", "X-Request-ID": hex(16), "X-Gateway-Instance": "gateway-1", "X-Cache": hit ? "HIT" : "MISS", ...headers } });
}
