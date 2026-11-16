import { useQuery } from "@tanstack/react-query";
import { Cpu, Database, HardDrive, Network, RefreshCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { ago, duration, num, shortId } from "@/lib/format";
import { Badge, Card, CardHeader, Dot, Empty, ErrorNote, PageHeader, Skeleton } from "@/components/ui";

const ICONS: Record<string, ReactNode> = {
  postgres: <Database className="h-4 w-4" />,
  redis: <HardDrive className="h-4 w-4" />,
  kafka: <Network className="h-4 w-4" />,
  llm_upstream: <Sparkles className="h-4 w-4" />,
};
const LABEL: Record<string, string> = { postgres: "PostgreSQL", redis: "Redis", kafka: "Kafka", llm_upstream: "LLM upstream" };
const ROLE: Record<string, string> = {
  postgres: "Tenants, keys and the request log",
  redis: "Rate-limit windows, response cache, worker heartbeats",
  kafka: "jobs and jobs-dlq topics",
  llm_upstream: "OpenAI-compatible model server",
};

export default function SystemHealth() {
  const q = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 5_000 });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="System health"
        description="Live dependency checks from the gateway and heartbeats from each worker. Refreshes every 5 seconds."
        actions={<button className="btn-outline h-8 text-xs" onClick={() => q.refetch()}><RefreshCw className={q.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh</button>}
      />
      <ErrorNote error={q.error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(d?.dependencies ?? Array.from({ length: 4 }, () => null)).map((dep, i) => (
          <Card key={dep?.name ?? i} className="p-4">
            {!dep ? <Skeleton className="h-16" /> : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">{ICONS[dep.name]}{LABEL[dep.name] ?? dep.name}</div>
                  <Dot ok={dep.ok} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular-nums">{dep.latency_ms}</span><span className="text-xs text-muted">ms</span>
                  <Badge tone={dep.ok ? "ok" : "bad"} className="ml-auto">{dep.ok ? "healthy" : "down"}</Badge>
                </div>
                <p className="text-xs text-faint mt-2">{dep.error ?? ROLE[dep.name]}</p>
              </>
            )}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Model providers" subtitle="Tried in priority order · circuit state is shared by every gateway and worker through Redis" />
          {!d ? <div className="p-4"><Skeleton className="h-20" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="border-b border-line"><tr><th className="th">#</th><th className="th">Provider</th><th className="th">Circuit</th><th className="th text-right">Recent failures</th><th className="th text-right">Times tripped</th><th className="th text-right">Ping</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.providers.map((p, i) => (
                    <tr key={p.name}>
                      <td className="td text-faint font-mono text-xs">{i + 1}</td>
                      <td className="td">
                        <div className="flex items-center gap-2"><Dot ok={p.reachable} /><span className="font-medium">{p.name}</span>{i === 0 && <Badge>primary</Badge>}</div>
                        <div className="text-[11px] text-faint font-mono mt-0.5 ml-5 truncate max-w-[280px]">{p.base_url}</div>
                      </td>
                      <td className="td">
                        {p.circuit === "closed" && <Badge tone="ok">closed</Badge>}
                        {p.circuit === "half_open" && <Badge tone="warn">half-open · probing</Badge>}
                        {p.circuit === "open" && <Badge tone="bad">open{p.open_until ? ` · retry in ${Math.max(0, Math.round(p.open_until - Date.now() / 1000))}s` : ""}</Badge>}
                      </td>
                      <td className="td text-right font-mono text-xs">{p.failures}</td>
                      <td className="td text-right font-mono text-xs">{p.trips}</td>
                      <td className="td text-right font-mono text-xs">{p.reachable ? `${p.latency_ms} ms` : <span className="text-bad">unreachable</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Reliability sweeper" subtitle={d?.sweeper.last_run ? `Leader ${d.sweeper.leader} · ran ${ago(d.sweeper.last_run)}` : "Waiting for first run"} />
          <div className="px-5 pb-5 space-y-2.5 text-sm">
            {!d ? <Skeleton className="h-32" /> : ([
              ["Outbox relays", d.sweeper.relayed, "queued rows never acknowledged by Kafka"],
              ["Stale re-publishes", d.sweeper.republished_stale, "queued long after publish (lost message)"],
              ["Leases reclaimed", d.sweeper.reclaimed, "worker died or stalled mid-job"],
              ["Poison jobs", d.sweeper.poisoned, `lost the lease ${d.sweeper.max_claims}× → DLQ`],
              ["Unpublished now", d.queue.unpublished ?? 0, "waiting for the relay"],
            ] as const).map(([k, v, hint]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
                <div><div className="text-muted">{k}</div><div className="text-[11px] text-faint">{hint}</div></div>
                <span className="font-mono text-sm tabular-nums">{num(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Workers" subtitle="Kafka consumer group “workers” · heartbeat every 5s, expires after 15s" />
          {!d ? <div className="p-4"><Skeleton className="h-24" /></div> : d.workers.length === 0 ? (
            <Empty icon={<Cpu className="h-5 w-5" />} title="No workers are reporting">Jobs will queue until a worker comes online.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="border-b border-line"><tr><th className="th">Worker</th><th className="th">State</th><th className="th text-right">Processed</th><th className="th text-right">Failed</th><th className="th text-right">Retries</th><th className="th text-right">Uptime</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.workers.map((w) => (
                    <tr key={w.id}>
                      <td className="td"><div className="flex items-center gap-2.5"><Dot ok /><span className="font-mono text-xs">{w.id}</span></div><div className="text-[11px] text-faint mt-0.5 ml-5">seen {ago(w.last_seen)}</div></td>
                      <td className="td">{w.current_job ? <Badge tone="info">busy · {shortId(w.current_job)}</Badge> : <Badge>idle</Badge>}</td>
                      <td className="td text-right font-mono text-xs">{num(w.processed)}</td>
                      <td className="td text-right font-mono text-xs">{num(w.failed)}</td>
                      <td className="td text-right font-mono text-xs">{num(w.retries)}</td>
                      <td className="td text-right text-xs text-muted">{duration(Math.floor((Date.now() - Date.parse(w.started_at)) / 1000))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Gateway" subtitle={d ? `Answered by ${d.instance}` : undefined} />
          <div className="px-5 pb-5 space-y-2.5 text-sm">
            {!d ? <Skeleton className="h-40" /> : ([
              ["Uptime", duration(d.uptime_s)],
              ["Queued jobs", num(d.queue.queued)],
              ["Processing", num(d.queue.processing)],
              ["Default model", d.config.default_model],
              ["Allowed models", d.config.models.join(", ")],
              ["Cache TTL", `${d.config.cache_ttl_s}s`],
              ["Max tokens cap", num(d.config.max_tokens_cap)],
              ["Upstream", d.config.llm_base_url],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
                <span className="text-muted">{k}</span><span className="font-mono text-xs text-right break-all">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
