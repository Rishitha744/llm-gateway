import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { num, pct } from "@/lib/format";
import { JobsExplorer } from "@/components/JobsExplorer";
import { StatTile } from "@/components/data";
import { Empty, PageHeader } from "@/components/ui";

export default function DeadLetters() {
  const o = useQuery({ queryKey: ["overview", "24h"], queryFn: () => api.overview("24h"), refetchInterval: 10_000 });
  const s = o.data?.summary;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dead letters"
        description="Jobs that exhausted their retries. Each was published to the jobs-dlq Kafka topic; fix the cause, then retry to put it back on the queue."
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile loading={o.isLoading} label="Failed · 24h" value={num(s?.failed)} />
        <StatTile loading={o.isLoading} label="Error rate · 24h" value={pct(s?.error_rate, 2)} />
        <StatTile label="Retry policy" value="4 attempts" sub="exponential backoff + jitter on 429/5xx, then DLQ" />
      </div>
      <JobsExplorer
        admin
        fixedStatus="failed"
        empty={<Empty icon={<CheckCircle2 className="h-5 w-5 text-ok" />} title="The dead-letter queue is empty">No job has exhausted its retries.</Empty>}
      />
    </div>
  );
}
