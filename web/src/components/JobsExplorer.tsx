import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, type JobFilters } from "@/lib/api";
import { JobDrawer, JobsTable } from "./data";
import { Card, ErrorNote, Segmented, Spinner, useToast } from "./ui";

const STATUSES = [
  { value: "", label: "All" },
  { value: "done", label: "Succeeded" },
  { value: "cached", label: "Cache hits" },
  { value: "processing", label: "Processing" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
];

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function JobsExplorer({ admin, fixedStatus, empty, toolbar }: {
  admin?: boolean; fixedStatus?: string; empty?: ReactNode; toolbar?: ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(fixedStatus ?? "");
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState<number | undefined>();
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(search.trim());

  const tenants = useQuery({ queryKey: ["tenants"], queryFn: api.tenants, enabled: !!admin });

  const filters: JobFilters = { status: status || undefined, q: q || undefined, tenant_id: tenantId, limit: 25 };
  const list = useInfiniteQuery({
    queryKey: ["jobs", admin ? "admin" : "tenant", filters],
    queryFn: ({ pageParam }) => (admin ? api.adminJobs : api.jobs)({ ...filters, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: 5_000,
  });

  const retry = useMutation({
    mutationFn: api.retryJob,
    onSuccess: () => {
      toast("Job re-queued");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job"] });
    },
    onError: (e) => toast((e as Error).message, "bad"),
  });

  const jobs = list.data?.pages.flatMap((p) => p.data);

  return (
    <>
      <Card>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 border-b border-line">
          {!fixedStatus && <Segmented value={status} onChange={setStatus} options={STATUSES} />}
          {admin && (
            <select className="input w-auto h-8 text-xs" value={tenantId ?? ""} onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">All tenants</option>
              {tenants.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="relative lg:ml-auto lg:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
            <input className="input h-8 pl-8 text-xs" placeholder="Search prompt or request ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {toolbar}
          <button className="btn-ghost h-8 w-8 px-0" onClick={() => list.refetch()} title="Refresh" aria-label="Refresh">
            <RefreshCw className={list.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
        {list.error && <div className="p-3"><ErrorNote error={list.error} /></div>}
        <JobsTable jobs={jobs} loading={list.isLoading} onOpen={(j) => setOpen(j.id)} showTenant={admin} empty={empty} />
        {list.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <button className="btn-ghost text-xs" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null} Load more
            </button>
          </div>
        )}
      </Card>
      <JobDrawer
        jobId={open}
        onClose={() => setOpen(null)}
        admin={admin}
        onRetry={admin ? (id) => retry.mutate(id) : undefined}
        retrying={retry.isPending}
      />
    </>
  );
}
