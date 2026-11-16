import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ms, num, pct } from "@/lib/format";
import type { RangeKey, Usage } from "@/lib/types";
import { LatencyChart, SingleAreaChart, TrafficChart } from "@/components/charts";
import { JobDrawer, JobsTable, RangePicker, StatTile } from "@/components/data";
import { Card, CardHeader, ErrorNote, PageHeader, Skeleton } from "@/components/ui";

export function KpiRow({ u, loading }: { u?: Usage; loading: boolean }) {
  const s = u?.summary;
  const spark = (k: "total" | "p95_ms" | "rate_limited") => u?.series.map((p) => p[k] ?? 0);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <StatTile loading={loading} label="Requests" value={num(s?.total)} sub={`${num(s?.in_flight)} in flight`} spark={spark("total")} />
      <StatTile loading={loading} label="Cache hit rate" value={pct(s?.cache_hit_rate)} sub={`${num(s?.cached)} served from cache`} />
      <StatTile loading={loading} label="p95 latency" value={ms(s?.p95_ms)} sub={`p50 ${ms(s?.p50_ms)}`} spark={spark("p95_ms")} tone="orange" />
      <StatTile loading={loading} label="Error rate" value={pct(s?.error_rate, 2)} sub={`${num(s?.failed)} failed`} />
      <StatTile loading={loading} label="Tokens used" value={num(s ? s.prompt_tokens + s.completion_tokens : undefined)} sub={`${num(s?.tokens_saved)} saved by cache`} />
      <StatTile loading={loading} label="Rate-limited" value={num(s?.rate_limited)} sub="rejected with 429" spark={spark("rate_limited")} tone="orange" />
    </div>
  );
}

export function UsageCharts({ u, loading }: { u?: Usage; loading: boolean }) {
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Traffic" subtitle="Requests per bucket, by how they were served" />
          <div className="px-5 pb-5">{loading || !u ? <Skeleton className="h-[270px]" /> : <TrafficChart series={u.series} bucketSeconds={u.bucket_seconds} />}</div>
        </Card>
        <Card>
          <CardHeader title="Model latency" subtitle={u?.summary.ttft_p50_ms != null ? `Upstream calls only · streaming TTFT p50 ${ms(u.summary.ttft_p50_ms)}` : "Upstream calls only (cache hits excluded)"} />
          <div className="px-5 pb-5">{loading || !u ? <Skeleton className="h-[230px]" /> : <LatencyChart series={u.series} bucketSeconds={u.bucket_seconds} height={230} />}</div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Token consumption" subtitle="Prompt + completion tokens sent to the model" />
          <div className="px-5 pb-5">{loading || !u ? <Skeleton className="h-[160px]" /> : <SingleAreaChart series={u.series} bucketSeconds={u.bucket_seconds} dataKey="tokens" label="Tokens" />}</div>
        </Card>
        <Card>
          <CardHeader title="Models" subtitle="Share of requests in range" />
          <div className="px-5 pb-5 space-y-3">
            {loading || !u ? <Skeleton className="h-24" /> : u.models.length === 0 ? <p className="text-sm text-muted">No traffic in this range.</p> : u.models.map((m) => {
              const share = u.summary.total ? m.total / u.summary.total : 0;
              return (
                <div key={m.model}>
                  <div className="flex justify-between text-sm"><span className="font-mono text-xs">{m.model}</span><span className="tabular-nums text-muted text-xs">{num(m.total)} · {pct(share, 0)}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-raised overflow-hidden"><div className="h-full rounded-full bg-[var(--s-blue)]" style={{ width: `${share * 100}%` }} /></div>
                  <div className="text-[11px] text-faint mt-1">{num(m.tokens)} tokens</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

export default function Overview() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [open, setOpen] = useState<string | null>(null);
  const usage = useQuery({ queryKey: ["usage", range], queryFn: () => api.usage(range), refetchInterval: 10_000 });
  const recent = useQuery({ queryKey: ["jobs", "recent"], queryFn: () => api.jobs({ limit: 6 }), refetchInterval: 5_000 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description="Traffic, cache efficiency and latency for this workspace."
        actions={<RangePicker value={range} onChange={setRange} />}
      />
      <ErrorNote error={usage.error} />
      <KpiRow u={usage.data} loading={usage.isLoading} />
      <UsageCharts u={usage.data} loading={usage.isLoading} />
      <Card>
        <CardHeader
          title="Recent requests"
          actions={<Link to="/requests" className="btn-ghost h-8 text-xs">View all <ArrowRight className="h-3.5 w-3.5" /></Link>}
        />
        <JobsTable
          jobs={recent.data?.data}
          loading={recent.isLoading}
          onOpen={(j) => setOpen(j.id)}
          empty={
            <div className="py-12 text-center">
              <p className="text-sm text-muted">No requests yet.</p>
              <Link to="/playground" className="btn-primary mt-4"><FlaskConical className="h-4 w-4" /> Open the playground</Link>
            </div>
          }
        />
      </Card>
      <JobDrawer jobId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
