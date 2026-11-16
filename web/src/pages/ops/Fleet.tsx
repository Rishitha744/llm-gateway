import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ago, num, pct } from "@/lib/format";
import type { RangeKey } from "@/lib/types";
import { RangePicker, StatTile } from "@/components/data";
import { Badge, Card, CardHeader, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { KpiRow, UsageCharts } from "../Overview";

export default function Fleet() {
  const [range, setRange] = useState<RangeKey>("24h");
  const o = useQuery({ queryKey: ["overview", range], queryFn: () => api.overview(range), refetchInterval: 10_000 });
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 10_000 });
  const tenants = [...(o.data?.tenants ?? [])].sort((a, b) => (b.requests_24h ?? 0) - (a.requests_24h ?? 0));
  const maxReq = Math.max(1, ...tenants.map((t) => t.requests_24h ?? 0));

  return (
    <div className="space-y-4">
      <PageHeader title="Fleet overview" description="Aggregate traffic across every tenant, plus queue and worker health." actions={<RangePicker value={range} onChange={setRange} />} />
      <ErrorNote error={o.error} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile loading={o.isLoading} label="Active tenants" value={num(o.data?.tenants.filter((t) => t.is_active).length)} sub={`${num(o.data?.tenants.length)} total`} />
        <StatTile loading={o.isLoading} label="Queue depth" value={num(o.data?.queue.queued)} sub={`${num(o.data?.queue.processing)} processing now`} />
        <StatTile loading={sys.isLoading} label="Workers online" value={num(sys.data?.workers.length)} sub={sys.data ? `${num(sys.data.workers.reduce((a, w) => a + w.processed, 0))} jobs processed` : undefined} />
        <StatTile loading={sys.isLoading} label="Dependencies" value={sys.data ? `${sys.data.dependencies.filter((d) => d.ok).length}/${sys.data.dependencies.length}` : "—"} sub="healthy" />
      </div>
      <KpiRow u={o.data} loading={o.isLoading} />
      <UsageCharts u={o.data} loading={o.isLoading} />
      <Card>
        <CardHeader title="Tenants by volume" subtitle="Last 24 hours" actions={<Link to="/ops/tenants" className="btn-ghost h-8 text-xs">Manage <ArrowRight className="h-3.5 w-3.5" /></Link>} />
        {o.isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-line"><tr><th className="th">Tenant</th><th className="th w-[38%]">Requests · 24h</th><th className="th text-right">Error rate</th><th className="th text-right">Quota</th><th className="th text-right">Last active</th></tr></thead>
              <tbody className="divide-y divide-line">
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td className="td font-medium">{t.name} {!t.is_active && <Badge tone="warn" className="ml-1">suspended</Badge>}</td>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden"><div className="h-full rounded-full bg-[var(--s-blue)]" style={{ width: `${((t.requests_24h ?? 0) / maxReq) * 100}%` }} /></div>
                        <span className="font-mono text-xs tabular-nums w-14 text-right">{num(t.requests_24h)}</span>
                      </div>
                    </td>
                    <td className="td text-right font-mono text-xs">{pct(t.requests_24h ? (t.failed_24h ?? 0) / t.requests_24h : 0, 2)}</td>
                    <td className="td text-right font-mono text-xs text-muted">{t.rate_limit_per_min}/min</td>
                    <td className="td text-right text-xs text-muted">{ago(t.last_used_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
