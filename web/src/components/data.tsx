import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Inbox, RotateCcw, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { ago, dateTime, ms, num, shortId } from "@/lib/format";
import type { Job, RangeKey } from "@/lib/types";
import { Sparkline } from "./charts";
import { Badge, Card, CopyButton, cx, Drawer, Empty, Segmented, Skeleton, Spinner, StatusBadge } from "./ui";

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[{ value: "1h", label: "1h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]}
    />
  );
}

export function StatTile({ label, value, sub, spark, tone, loading }: {
  label: string; value: ReactNode; sub?: ReactNode; spark?: number[]; tone?: "blue" | "orange"; loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        {loading ? <Skeleton className="h-7 w-24" /> : <div className="text-2xl font-semibold tracking-tight tabular-nums whitespace-nowrap">{value}</div>}
        {spark && !loading && <div className="min-w-0 overflow-hidden hidden sm:block"><Sparkline values={spark} tone={tone} /></div>}
      </div>
      {sub && <div className="mt-1.5 text-xs text-faint">{loading ? <Skeleton className="h-3 w-20" /> : sub}</div>}
    </Card>
  );
}

export function JobsTable({ jobs, loading, onOpen, showTenant, empty }: {
  jobs: Job[] | undefined; loading?: boolean; onOpen: (j: Job) => void; showTenant?: boolean; empty?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
      </div>
    );
  }
  if (!jobs?.length) return <>{empty ?? <Empty icon={<Inbox className="h-5 w-5" />} title="No requests yet">Send one from the Playground.</Empty>}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="border-b border-line">
          <tr>
            <th className="th">Request</th>
            {showTenant && <th className="th">Tenant</th>}
            <th className="th">Status</th>
            <th className="th">Prompt</th>
            <th className="th text-right">Latency</th>
            <th className="th text-right">Tokens</th>
            <th className="th text-right">Created</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onOpen(j)} className="cursor-pointer hover:bg-raised/50 transition-colors group">
              <td className="td">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{shortId(j.id)}</span>
                  <Badge className="uppercase tracking-wide !text-[10px]">{j.kind}</Badge>
                </div>
              </td>
              {showTenant && <td className="td text-muted">{j.tenant_name}</td>}
              <td className="td"><StatusBadge status={j.status} cached={j.cached} /></td>
              <td className="td max-w-[340px]"><div className="truncate text-muted">{j.prompt}</div></td>
              <td className="td text-right font-mono text-xs tabular-nums">{j.cached ? <span className="text-cache">{ms(j.latency_ms)}</span> : ms(j.latency_ms)}</td>
              <td className="td text-right font-mono text-xs tabular-nums text-muted">
                {j.prompt_tokens != null ? num((j.prompt_tokens ?? 0) + (j.completion_tokens ?? 0)) : "—"}
              </td>
              <td className="td text-right text-xs text-muted whitespace-nowrap" title={dateTime(j.created_at)}>{ago(j.created_at)}</td>
              <td className="pr-3"><ChevronRight className="h-4 w-4 text-faint opacity-0 group-hover:opacity-100" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ job }: { job: Job }) {
  const steps = [
    { label: "Accepted", at: job.created_at, done: true },
    { label: job.cached ? "Cache lookup" : "Queued (Kafka)", at: job.created_at, done: true },
    {
      label: [
        "Processing",
        job.provider && `via ${job.provider}`,
        job.attempts > 1 && `${job.attempts} attempts`,
        job.claims > 1 && `reclaimed ${job.claims - 1}× after lease expiry`,
      ].filter(Boolean).join(" · "),
      at: job.started_at,
      done: !!job.started_at,
    },
    { label: job.status === "failed" ? "Failed → DLQ" : "Completed", at: job.completed_at, done: !!job.completed_at },
  ];
  const visible = job.cached ? [steps[0], steps[1], steps[3]] : job.kind === "sync" ? [steps[0], steps[2], steps[3]] : steps;
  return (
    <ol className="relative space-y-4 pl-6 before:absolute before:left-[7px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line">
      {visible.map((s, i) => {
        const last = i === visible.length - 1;
        const failed = last && job.status === "failed";
        const active = !s.done && (i === 0 || visible[i - 1].done);
        return (
          <li key={s.label} className="relative">
            <span className={cx(
              "absolute -left-6 top-0.5 h-[15px] w-[15px] rounded-full border-2 grid place-items-center bg-panel",
              failed ? "border-bad" : s.done ? "border-ok" : active ? "border-info" : "border-line",
            )}>
              {s.done && <span className={cx("h-1.5 w-1.5 rounded-full", failed ? "bg-bad" : "bg-ok")} />}
              {active && <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />}
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <span className={cx("text-sm", s.done ? "text-fg" : "text-faint")}>{s.label}</span>
              <span className="text-xs text-faint font-mono">{s.at && s.done ? new Date(s.at).toLocaleTimeString() : active ? <Spinner className="h-3 w-3" /> : ""}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-faint uppercase tracking-wider">{k}</div>
      <div className={cx("text-sm mt-0.5", mono && "font-mono text-xs")}>{v}</div>
    </div>
  );
}

export function JobDetail({ job }: { job: Job }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={job.status} cached={job.cached} />
        <Badge className="uppercase">{job.kind}</Badge>
        <Badge>{job.model}</Badge>
        {job.cached && <Badge tone="info"><Zap className="h-3 w-3" /> served from cache</Badge>}
        {job.provider && <Badge className="font-mono">{job.provider}</Badge>}
        {job.idempotency_key && <Badge tone="accent" className="font-mono">key {job.idempotency_key}</Badge>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KV k="Queue wait" v={ms(job.queue_ms)} mono />
        <KV k="Model latency" v={ms(job.latency_ms)} mono />
        <KV k="End-to-end" v={ms(job.total_ms)} mono />
        <KV k="Attempts" v={job.attempts} mono />
        <KV k="Prompt tokens" v={num(job.prompt_tokens)} mono />
        <KV k="Completion tokens" v={num(job.completion_tokens)} mono />
        <KV k="Max tokens" v={job.max_tokens} mono />
        <KV k="Tenant" v={job.tenant_name} />
        {job.ttft_ms != null && <KV k="Time to first token" v={ms(job.ttft_ms)} mono />}
        {job.kind === "async" && <KV k="Worker claims" v={job.claims} mono />}
      </div>

      <div>
        <div className="label">Lifecycle</div>
        <div className="card p-4 bg-bg"><Timeline job={job} /></div>
      </div>

      <div>
        <div className="label">Prompt</div>
        <div className="rounded-lg border border-line bg-bg p-3 text-sm whitespace-pre-wrap">{job.prompt}</div>
      </div>

      {job.result && (
        <div>
          <div className="flex items-center justify-between"><span className="label">Response</span><CopyButton text={job.result} /></div>
          <div className="rounded-lg border border-line bg-bg p-3 text-sm whitespace-pre-wrap leading-relaxed">{job.result}</div>
        </div>
      )}
      {job.error && (
        <div>
          <div className="label">Error</div>
          <div className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-xs font-mono text-bad whitespace-pre-wrap flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {job.error}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-line">
        <KV k="Request ID" v={<span className="flex items-center gap-1">{job.id}<CopyButton text={job.id} /></span>} mono />
        <KV k="Created" v={dateTime(job.created_at)} />
      </div>
    </div>
  );
}

/** Drawer that live-refreshes a job until it reaches a terminal state. */
export function JobDrawer({ jobId, onClose, admin, onRetry, retrying }: {
  jobId: string | null; onClose: () => void; admin?: boolean; onRetry?: (id: string) => void; retrying?: boolean;
}) {
  const q = useQuery({
    queryKey: ["job", admin ? "admin" : "tenant", jobId],
    queryFn: () => (admin ? api.adminJob(jobId!) : api.job(jobId!)),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "queued" || s === "processing" ? 800 : false;
    },
  });
  const job = q.data;
  return (
    <Drawer
      open={!!jobId}
      onClose={onClose}
      title={<span className="font-mono">{jobId ? `req_${shortId(jobId)}` : ""}</span>}
      actions={onRetry && job?.status === "failed" && job.kind === "async" ? (
        <button className="btn-outline h-8 text-xs" onClick={() => onRetry(job.id)} disabled={retrying}>
          {retrying ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />} Retry
        </button>
      ) : undefined}
    >
      {q.isLoading && <div className="space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-28" /><Skeleton className="h-40" /></div>}
      {job && <JobDetail job={job} />}
    </Drawer>
  );
}
