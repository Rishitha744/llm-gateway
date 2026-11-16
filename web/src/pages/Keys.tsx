import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import type { ApiKey } from "@/lib/types";
import { KeyReveal } from "@/components/KeyReveal";
import { Badge, Card, Empty, ErrorNote, Field, Modal, PageHeader, Skeleton, Spinner, useToast } from "@/components/ui";

export function KeysTable({ keys, currentId, onRevoke, revoking }: {
  keys: ApiKey[]; currentId?: number; onRevoke: (k: ApiKey) => void; revoking?: number | null;
}) {
  if (!keys.length) return <Empty icon={<KeyRound className="h-5 w-5" />} title="No keys yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-b border-line">
          <tr><th className="th">Name</th><th className="th">Key</th><th className="th">Status</th><th className="th">Created</th><th className="th">Last used</th><th className="th" /></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {keys.map((k) => (
            <tr key={k.id} className={k.is_active ? "" : "opacity-60"}>
              <td className="td font-medium">
                {k.name}
                {k.id === currentId && <Badge tone="accent" className="ml-2">this session</Badge>}
              </td>
              <td className="td font-mono text-xs text-muted">{k.key_prefix}••••••••</td>
              <td className="td">{k.is_active ? <Badge tone="ok">active</Badge> : <Badge>revoked {ago(k.revoked_at)}</Badge>}</td>
              <td className="td text-xs text-muted" title={dateTime(k.created_at)}>{ago(k.created_at)}</td>
              <td className="td text-xs text-muted" title={dateTime(k.last_used_at)}>{ago(k.last_used_at)}</td>
              <td className="td text-right">
                {k.is_active && k.id !== currentId && (
                  <button className="btn-danger h-7 text-xs" onClick={() => onRevoke(k)} disabled={revoking === k.id}>
                    {revoking === k.id ? <Spinner className="h-3 w-3" /> : "Revoke"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Keys() {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: ["keys"], queryFn: api.keys });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<ApiKey | null>(null);
  const [confirm, setConfirm] = useState<ApiKey | null>(null);

  const create = useMutation({
    mutationFn: () => api.createKey(name.trim() || "default"),
    onSuccess: (k) => {
      setCreating(false);
      setName("");
      setRevealed(k);
      qc.invalidateQueries({ queryKey: ["keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.revokeKey(id),
    onSuccess: (k) => {
      toast(`Revoked “${k.name}”`);
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (e) => toast((e as Error).message, "bad"),
  });

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Keys authenticate requests as this workspace. Rotate by creating a new key, deploying it, then revoking the old one."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create key</button>}
      />
      <Card>
        {keys.isLoading ? <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <KeysTable keys={keys.data?.data ?? []} currentId={keys.data?.current_key_id} onRevoke={setConfirm} revoking={revoke.isPending ? revoke.variables : null} />
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create API key" footer={<>
        <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending && <Spinner />} Create</button>
      </>}>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
          <Field label="Name" hint="Something that tells you where it's deployed, e.g. “production” or “ci”.">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="production" autoFocus maxLength={64} />
          </Field>
          <ErrorNote error={create.error} />
        </form>
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Revoke key?" footer={<>
        <button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
        <button className="btn-danger" onClick={() => confirm && revoke.mutate(confirm.id)} disabled={revoke.isPending}>{revoke.isPending && <Spinner />} Revoke key</button>
      </>}>
        <p className="text-sm text-muted">Requests using <span className="font-mono text-fg">{confirm?.key_prefix}…</span> (“{confirm?.name}”) will start failing with 401 immediately. This can't be undone.</p>
      </Modal>

      <KeyReveal apiKey={revealed} onClose={() => setRevealed(null)} />
    </div>
  );
}
