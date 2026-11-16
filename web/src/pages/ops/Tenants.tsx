import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ago, ms, num, pct } from "@/lib/format";
import type { ApiKey, Tenant } from "@/lib/types";
import { TrafficChart } from "@/components/charts";
import { KeyReveal } from "@/components/KeyReveal";
import { Badge, Card, Drawer, ErrorNote, Field, Modal, PageHeader, Skeleton, Spinner, useToast } from "@/components/ui";
import { KeysTable } from "../Keys";

function TenantDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tenant", id], queryFn: () => api.tenant(id!), enabled: id != null });
  const [limit, setLimit] = useState("");
  const [keyName, setKeyName] = useState("");
  const [revealed, setRevealed] = useState<ApiKey | null>(null);

  useEffect(() => {
    if (q.data) setLimit(String(q.data.tenant.rate_limit_per_min));
  }, [q.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenant", id] });
    qc.invalidateQueries({ queryKey: ["tenants"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };
  const update = useMutation({
    mutationFn: (body: { rate_limit_per_min?: number; is_active?: boolean }) => api.updateTenant(id!, body),
    onSuccess: () => { toast("Tenant updated"); refresh(); },
    onError: (e) => toast((e as Error).message, "bad"),
  });
  const createKey = useMutation({
    mutationFn: () => api.createTenantKey(id!, keyName.trim() || "default"),
    onSuccess: (k) => { setKeyName(""); setRevealed(k); refresh(); },
  });
  const revoke = useMutation({
    mutationFn: (kid: number) => api.adminRevokeKey(kid),
    onSuccess: () => { toast("Key revoked"); refresh(); },
  });

  const t = q.data?.tenant;
  const u = q.data?.usage;
  return (
    <Drawer open={id != null} onClose={onClose} title={t?.name ?? "Tenant"}>
      {!q.data ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-48" /></div> : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 bg-bg"><div className="text-[11px] text-faint">Requests 24h</div><div className="text-lg font-semibold tabular-nums">{num(u?.summary.total)}</div></div>
            <div className="card p-3 bg-bg"><div className="text-[11px] text-faint">Cache hit rate</div><div className="text-lg font-semibold tabular-nums">{pct(u?.summary.cache_hit_rate)}</div></div>
            <div className="card p-3 bg-bg"><div className="text-[11px] text-faint">p95 latency</div><div className="text-lg font-semibold tabular-nums">{ms(u?.summary.p95_ms)}</div></div>
          </div>
          {u && <TrafficChart series={u.series} bucketSeconds={u.bucket_seconds} height={150} />}

          <div className="space-y-3">
            <div className="label !mb-0">Quota & status</div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); update.mutate({ rate_limit_per_min: Number(limit) }); }}>
              <Field label="Requests per minute">
                <input className="input w-40 font-mono" type="number" min={1} max={100000} value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Field>
              <button className="btn-outline" disabled={update.isPending || Number(limit) === t!.rate_limit_per_min || Number(limit) < 1}>Save</button>
            </form>
            <div className="flex items-center justify-between rounded-lg border border-line p-3">
              <div>
                <div className="text-sm font-medium">{t!.is_active ? "Active" : "Suspended"}</div>
                <div className="text-xs text-muted">{t!.is_active ? "All active keys can make requests." : "Every key for this tenant is rejected with 401."}</div>
              </div>
              <button className={t!.is_active ? "btn-danger" : "btn-outline"} onClick={() => update.mutate({ is_active: !t!.is_active })} disabled={update.isPending}>
                {t!.is_active ? "Suspend" : "Reactivate"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="label !mb-0">API keys</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); createKey.mutate(); }}>
              <input className="input" placeholder="New key name" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={64} />
              <button className="btn-outline" disabled={createKey.isPending}>{createKey.isPending ? <Spinner /> : <Plus className="h-4 w-4" />} Issue key</button>
            </form>
            <div className="card overflow-hidden">
              <KeysTable keys={q.data.keys} onRevoke={(k) => revoke.mutate(k.id)} revoking={revoke.isPending ? revoke.variables : null} />
            </div>
          </div>
        </div>
      )}
      <KeyReveal apiKey={revealed} onClose={() => setRevealed(null)} />
    </Drawer>
  );
}

export default function Tenants() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["tenants"], queryFn: api.tenants, refetchInterval: 15_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("60");
  const [revealed, setRevealed] = useState<ApiKey | null>(null);

  const create = useMutation({
    mutationFn: () => api.createTenant({ name: name.trim(), rate_limit_per_min: Number(limit) }),
    onSuccess: (r) => {
      setCreating(false);
      setName("");
      setRevealed(r.api_key);
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const rows: Tenant[] = list.data?.data ?? [];
  return (
    <div>
      <PageHeader
        title="Tenants"
        description="Each tenant has its own keys, quota, cache namespace and Kafka partition key."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New tenant</button>}
      />
      <ErrorNote error={list.error} />
      <Card>
        {list.isLoading ? <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-line"><tr><th className="th">Tenant</th><th className="th">Status</th><th className="th text-right">Quota</th><th className="th text-right">Active keys</th><th className="th text-right">Requests · 24h</th><th className="th text-right">Failed · 24h</th><th className="th text-right">Last active</th><th className="w-8" /></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-raised/50 group" onClick={() => setOpen(t.id)}>
                    <td className="td"><div className="font-medium">{t.name}</div><div className="text-[11px] text-faint">id {t.id} · created {ago(t.created_at)}</div></td>
                    <td className="td">{t.is_active ? <Badge tone="ok">active</Badge> : <Badge tone="warn">suspended</Badge>}</td>
                    <td className="td text-right font-mono text-xs">{t.rate_limit_per_min}/min</td>
                    <td className="td text-right font-mono text-xs">{t.active_keys}</td>
                    <td className="td text-right font-mono text-xs">{num(t.requests_24h)}</td>
                    <td className="td text-right font-mono text-xs">{num(t.failed_24h)}</td>
                    <td className="td text-right text-xs text-muted">{ago(t.last_used_at)}</td>
                    <td className="pr-3"><ChevronRight className="h-4 w-4 text-faint opacity-0 group-hover:opacity-100" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="New tenant" footer={<>
        <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending || name.trim().length < 2}>{create.isPending && <Spinner />} Create tenant</button>
      </>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name" hint="Letters, numbers, dashes and underscores.">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-corp" autoFocus />
          </Field>
          <Field label="Rate limit (requests per minute)">
            <input className="input font-mono" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <p className="text-xs text-muted">A default API key is issued automatically and shown once.</p>
          <ErrorNote error={create.error} />
        </form>
      </Modal>

      <TenantDrawer id={open} onClose={() => setOpen(null)} />
      <KeyReveal apiKey={revealed} onClose={() => setRevealed(null)} title="Tenant created" />
    </div>
  );
}
