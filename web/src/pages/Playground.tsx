import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bolt, KeyRound, Layers, Play, Radio, Repeat, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Meta } from "@/lib/api";
import { ms } from "@/lib/format";
import type { Job } from "@/lib/types";
import { JobDetail } from "@/components/data";
import { Badge, Card, CardHeader, CodeBlock, cx, ErrorNote, Field, PageHeader, Segmented, Spinner } from "@/components/ui";

type Mode = "async" | "sync";

const EXAMPLES = [
  "Explain the CAP theorem to a new backend engineer in 4 sentences.",
  "Write a haiku about message queues.",
  "Give me 3 name ideas for a developer analytics startup.",
  "Tell me a joke about distributed systems.",
];

interface Run {
  mode: Mode;
  meta?: Meta;
  jobId?: string;
  idempotencyKey?: string;
  replayed?: boolean;
  sync?: {
    content: string; cached: boolean; streaming?: boolean; done: boolean;
    usage: { prompt_tokens: number; completion_tokens: number } | null;
    requestId?: string; provider?: string | null; ttftMs?: number | null; elapsedMs?: number;
  };
  error?: ApiError | Error;
}

const newKey = () => `pg-${Math.random().toString(36).slice(2, 10)}`;

function HeaderRow({ k, v, tone }: { k: string; v?: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-line last:border-0">
      <span className="font-mono text-[11px] text-faint">{k}</span>
      <span className={cx("font-mono text-xs tabular-nums truncate", tone)}>{v ?? "—"}</span>
    </div>
  );
}

function curlFor(mode: Mode, prompt: string, model: string, maxTokens: number, stream: boolean, idemKey: string | null) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
  const body = mode === "async"
    ? { prompt, model, max_tokens: maxTokens }
    : { model, max_tokens: maxTokens, ...(stream ? { stream: true } : {}), messages: [{ role: "user", content: prompt }] };
  const path = mode === "async" ? "/v1/jobs" : "/v1/chat/completions";
  const idem = mode === "async" && idemKey ? `\n  -H "Idempotency-Key: ${idemKey}" \\` : "";
  return `curl -s${stream && mode === "sync" ? "N" : ""} ${origin}${path} \\
  -H "Authorization: Bearer $GATEWAY_API_KEY" \\${idem}
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
}

export default function Playground() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  const [mode, setMode] = useState<Mode>("async");
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [model, setModel] = useState("");
  const [maxTokens, setMaxTokens] = useState(300);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [burst, setBurst] = useState<{ status: number | "…"; cached?: boolean }[] | null>(null);
  const [stream, setStream] = useState(true);
  const [useIdem, setUseIdem] = useState(true);
  const [idemKey, setIdemKey] = useState(newKey);

  useEffect(() => {
    if (!model && me.data) setModel(me.data.defaults.model);
  }, [me.data, model]);

  const job = useQuery({
    queryKey: ["job", "tenant", run?.jobId],
    queryFn: () => api.job(run!.jobId!),
    enabled: !!run?.jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return !s || s === "queued" || s === "processing" ? 600 : false;
    },
  });

  async function send(replay = false) {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setRun(null);
    setBurst(null);
    try {
      if (mode === "async") {
        const key = useIdem ? (replay ? idemKey : newKey()) : undefined;
        if (key) setIdemKey(key);
        const { data, meta } = await api.submitJob({ prompt, model, max_tokens: maxTokens }, key);
        setRun({ mode, meta, jobId: data.job_id, idempotencyKey: key, replayed: meta.headers["idempotent-replayed"] === "true" });
      } else if (stream) {
        const started = performance.now();
        setRun({ mode, sync: { content: "", cached: false, streaming: true, done: false, usage: null } });
        const { data, meta } = await api.chatStream(
          { model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] },
          (text, ttftMs) => setRun((r) => r?.sync ? { ...r, sync: { ...r.sync, content: r.sync.content + text, ttftMs } } : r),
        );
        const elapsedMs = Math.round(performance.now() - started);
        setRun((r) => ({
          mode, meta,
          sync: {
            content: data.content, cached: !!data.x_gateway?.cached, streaming: true, done: true, usage: data.usage,
            requestId: data.x_gateway?.request_id, provider: data.x_gateway?.provider,
            // Client-measured TTFT, so it shares a clock with elapsedMs.
            ttftMs: r?.sync?.ttftMs ?? data.x_gateway?.ttft_ms, elapsedMs,
          },
        }));
      } else {
        const { data, meta } = await api.chat({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] });
        setRun({
          mode, meta,
          sync: { content: data.choices[0].message.content, cached: data.x_gateway.cached, done: true, usage: data.usage, requestId: data.x_gateway.request_id, provider: data.x_gateway.provider },
        });
      }
    } catch (e) {
      setRun({ mode, error: e as Error });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    }
  }

  async function burstTest() {
    const n = Math.min(40, (me.data?.rate_limit.per_minute ?? 20) + 8);
    setRun(null);
    setBurst(Array.from({ length: n }, () => ({ status: "…" })));
    setBusy(true);
    await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        try {
          const { data, meta } = await api.submitJob({ prompt: `${prompt} (#${(i % 4) + 1})`, model, max_tokens: maxTokens });
          setBurst((b) => b && b.map((x, j) => (j === i ? { status: meta.status, cached: data.cached } : x)));
        } catch (e) {
          setBurst((b) => b && b.map((x, j) => (j === i ? { status: e instanceof ApiError ? e.status : 0 } : x)));
        }
      }),
    );
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["usage"] });
  }

  const curl = useMemo(
    () => curlFor(mode, prompt, model || "llama3.2", maxTokens, stream, useIdem ? idemKey : null),
    [mode, prompt, model, maxTokens, stream, useIdem, idemKey],
  );
  const h = run?.meta?.headers ?? {};
  const err = run?.error;
  const errHeaders = err instanceof ApiError ? err.headers : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Playground"
        description="Send a prompt through the gateway and watch it move through cache, queue and worker in real time."
      />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start">
        <Card>
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                size="md"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "async", label: <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Async job</span> },
                  { value: "sync", label: <span className="flex items-center gap-1.5"><Bolt className="h-3.5 w-3.5" /> Sync (OpenAI)</span> },
                ]}
              />
              <span className="text-xs text-faint font-mono">{mode === "async" ? "POST /v1/jobs" : "POST /v1/chat/completions"}</span>
            </div>
            <p className="text-xs text-muted -mt-1">
              {mode === "async"
                ? "Returns 202 immediately; a worker leases the job from Kafka, fails over between providers, retries transient errors and dead-letters it if they persist."
                : "OpenAI-compatible. With streaming on, tokens arrive as server-sent events; failover between providers happens before the first token."}
            </p>
            {mode === "sync" ? (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
                <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} className="accent-[rgb(var(--accent))] h-4 w-4" />
                <Radio className="h-3.5 w-3.5 text-muted" /> Stream tokens <span className="text-xs text-faint font-mono">stream: true</span>
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
                <input type="checkbox" checked={useIdem} onChange={(e) => setUseIdem(e.target.checked)} className="accent-[rgb(var(--accent))] h-4 w-4" />
                <KeyRound className="h-3.5 w-3.5 text-muted" /> Send an <span className="font-mono text-xs">Idempotency-Key</span>
              </label>
            )}

            <Field label="Prompt">
              <textarea
                className="input h-auto min-h-[150px] py-2.5 leading-relaxed resize-y"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                }}
                placeholder="Ask anything…"
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setPrompt(ex)} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:text-fg hover:border-accent/50 transition-colors max-w-[260px] truncate">
                  {ex}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Model">
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                  {(models.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </Field>
              <Field label={`Max tokens · ${maxTokens}`}>
                <input type="range" min={16} max={me.data?.defaults.max_tokens_cap ?? 2048} step={16} value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))] h-9" />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className="btn-primary" onClick={() => send()} disabled={busy || !prompt.trim()}>
                {busy && !burst ? <Spinner /> : <Play className="h-4 w-4" />} Send request
              </button>
              <span className="kbd hidden sm:inline">Ctrl ↵</span>
              {mode === "async" && useIdem && run?.idempotencyKey && (
                <button className="btn-outline" onClick={() => send(true)} disabled={busy} title="Simulates a client retry after a timeout">
                  <Repeat className="h-4 w-4" /> Retry with same key
                </button>
              )}
              <button className="btn-outline ml-auto" onClick={burstTest} disabled={busy || !prompt.trim()} title="Fire requests in parallel to exceed the per-minute quota">
                <Repeat className="h-4 w-4" /> Burst test
              </button>
            </div>
            <p className="text-xs text-faint">Send the same prompt twice to see a cache hit. Prompts containing “fail” exercise the retry → DLQ path in demo mode.</p>
          </div>
          <div className="border-t border-line p-5">
            <CodeBlock lang="curl" code={curl} />
          </div>
        </Card>

        <div className="space-y-4">
          {!run && !burst && (
            <Card className="p-10 text-center">
              <Zap className="h-6 w-6 mx-auto text-accent" />
              <p className="mt-3 text-sm font-medium">Responses show up here</p>
              <p className="text-sm text-muted mt-1">including gateway headers, cache status and the job lifecycle.</p>
            </Card>
          )}

          {burst && (
            <Card>
              <CardHeader
                title="Burst test"
                subtitle={`${burst.length} parallel requests against a ${me.data?.rate_limit.per_minute ?? "?"}/min quota`}
                actions={
                  <div className="flex gap-1.5 text-xs">
                    <Badge tone="ok">{burst.filter((b) => b.status === 202 || b.status === 200).length} accepted</Badge>
                    <Badge tone="warn">{burst.filter((b) => b.status === 429).length} × 429</Badge>
                  </div>
                }
              />
              <div className="px-5 pb-5 grid grid-cols-8 sm:grid-cols-10 gap-1.5">
                {burst.map((b, i) => (
                  <div key={i} title={String(b.status)} className={cx(
                    "h-9 rounded-md grid place-items-center font-mono text-[11px] border transition-colors",
                    b.status === "…" && "border-line text-faint animate-pulse",
                    (b.status === 202 || b.status === 200) && (b.cached ? "border-cache/30 bg-cache/10 text-cache" : "border-ok/30 bg-ok/10 text-ok"),
                    b.status === 429 && "border-warn/30 bg-warn/10 text-warn",
                    typeof b.status === "number" && ![200, 202, 429].includes(b.status) && "border-bad/30 bg-bad/10 text-bad",
                  )}>
                    {b.status}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {run && (
            <Card>
              <CardHeader
                title="Gateway response"
                actions={
                  run.meta ? <Badge tone={run.meta.status < 300 ? "ok" : "bad"} className="font-mono">HTTP {run.meta.status}</Badge>
                    : err instanceof ApiError ? <Badge tone={err.status === 429 ? "warn" : "bad"} className="font-mono">HTTP {err.status}</Badge> : null
                }
              />
              <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <div>
                  <HeaderRow k="x-cache" v={h["x-cache"]} tone={h["x-cache"] === "HIT" ? "text-cache" : undefined} />
                  <HeaderRow k="x-ratelimit-remaining" v={h["x-ratelimit-remaining"] ?? errHeaders?.get("x-ratelimit-remaining") ?? undefined} />
                  <HeaderRow k="x-ratelimit-reset" v={(h["x-ratelimit-reset"] ?? errHeaders?.get("x-ratelimit-reset")) ? `${h["x-ratelimit-reset"] ?? errHeaders?.get("x-ratelimit-reset")}s` : undefined} />
                </div>
                <div>
                  <HeaderRow k="x-request-id" v={h["x-request-id"] ?? errHeaders?.get("x-request-id") ?? undefined} />
                  <HeaderRow k="x-gateway-instance" v={h["x-gateway-instance"] ?? errHeaders?.get("x-gateway-instance") ?? undefined} />
                  <HeaderRow k="round-trip" v={run.meta ? ms(run.meta.ms) : undefined} />
                  {run.mode === "async" && <HeaderRow k="idempotent-replayed" v={h["idempotent-replayed"] ?? (run.idempotencyKey ? "false" : undefined)} tone={run.replayed ? "text-accent" : undefined} />}
                </div>
              </div>
            </Card>
          )}

          {err && <ErrorNote error={err} />}

          {run?.replayed && (
            <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
              Replayed: the gateway returned the original job for key <span className="font-mono text-xs">{run.idempotencyKey}</span> instead of creating a duplicate.
            </div>
          )}

          {run?.sync && (
            <Card className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {run.sync.done ? <Badge tone="ok">completed</Badge> : <Badge tone="info"><Spinner className="h-3 w-3" /> streaming</Badge>}
                {run.sync.streaming && <Badge><Radio className="h-3 w-3" /> SSE</Badge>}
                {run.sync.cached && <Badge tone="info"><Zap className="h-3 w-3" /> cache hit</Badge>}
                {run.sync.provider && <Badge className="font-mono">{run.sync.provider}</Badge>}
                <span className="ml-auto text-xs text-faint font-mono">
                  {run.sync.ttftMs != null && <>TTFT {ms(run.sync.ttftMs)} · </>}
                  {run.sync.usage ? `${run.sync.usage.prompt_tokens} + ${run.sync.usage.completion_tokens} tokens` : "…"}
                  {run.sync.done && run.sync.usage && run.sync.elapsedMs && run.sync.ttftMs != null && run.sync.elapsedMs > run.sync.ttftMs
                    ? ` · ${(run.sync.usage.completion_tokens / ((run.sync.elapsedMs - run.sync.ttftMs) / 1000)).toFixed(1)} tok/s` : ""}
                </span>
              </div>
              <div className="rounded-lg border border-line bg-bg p-3 text-sm whitespace-pre-wrap leading-relaxed min-h-[3rem]">
                {run.sync.content}
                {!run.sync.done && <span className="inline-block w-2 h-4 align-text-bottom bg-accent animate-pulse ml-0.5" />}
              </div>
            </Card>
          )}

          {run?.jobId && (
            <Card className="p-5">
              {job.data ? <JobDetail job={job.data as Job} /> : <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Waiting for job…</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
