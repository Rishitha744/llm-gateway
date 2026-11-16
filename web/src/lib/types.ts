export type JobStatus = "queued" | "processing" | "done" | "failed";
export type RangeKey = "1h" | "24h" | "7d";

export interface Job {
  id: string;
  tenant_id: number;
  tenant_name: string;
  kind: "async" | "sync" | "stream";
  status: JobStatus;
  cached: boolean;
  model: string;
  max_tokens: number;
  prompt: string;
  result: string | null;
  error: string | null;
  attempts: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  queue_ms: number | null;
  total_ms: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  provider: string | null;
  ttft_ms: number | null;
  claims: number;
  idempotency_key: string | null;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface UsagePoint {
  t: string;
  total: number;
  cached: number;
  failed: number;
  succeeded: number;
  in_flight: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens_saved: number;
  p50_ms: number | null;
  p95_ms: number | null;
  ttft_p50_ms: number | null;
  rate_limited: number;
}

export interface UsageSummary extends Omit<UsagePoint, "t"> {
  cache_hit_rate: number;
  error_rate: number;
}

export interface Usage {
  range: RangeKey;
  bucket_seconds: number;
  summary: UsageSummary;
  series: UsagePoint[];
  models: { model: string; total: number; tokens: number }[];
}

export interface QueueDepth {
  queued: number;
  processing: number;
  oldest_queued_at: string | null;
  unpublished?: number;
  expired_leases?: number;
}

export interface Tenant {
  id: number;
  name: string;
  rate_limit_per_min: number;
  is_active: boolean;
  created_at: string;
  active_keys?: number;
  last_used_at?: string | null;
  requests_24h?: number;
  failed_24h?: number;
}

export interface AdminOverview extends Usage {
  tenants: Tenant[];
  queue: QueueDepth;
}

export interface ApiKey {
  id: number;
  tenant_id: number;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  key?: string;
}

export interface Me {
  tenant: { id: number; name: string };
  key: { id: number; name: string; prefix: string };
  rate_limit: { per_minute: number; used_this_minute: number };
  defaults: { model: string; max_tokens: number; max_tokens_cap: number; cache_ttl_s: number };
}

export interface DependencyCheck {
  name: string;
  ok: boolean;
  latency_ms: number;
  error: string | null;
}

export interface WorkerInfo {
  id: string;
  started_at: string;
  last_seen: string;
  processed: number;
  failed: number;
  retries: number;
  current_job: string | null;
  lost_leases?: number;
}

export interface ProviderStatus {
  name: string;
  base_url: string;
  models: Record<string, string> | null;
  reachable: boolean;
  latency_ms: number;
  circuit: "closed" | "open" | "half_open";
  failures: number;
  trips: number;
  open_until: number | null;
}

export interface SweeperStats {
  last_run: string | null;
  leader: string | null;
  interval_s: number;
  relayed: number;
  republished_stale: number;
  reclaimed: number;
  poisoned: number;
  max_claims: number;
}

export interface SystemSnapshot {
  instance: string;
  uptime_s: number;
  dependencies: DependencyCheck[];
  workers: WorkerInfo[];
  queue: QueueDepth;
  providers: ProviderStatus[];
  sweeper: SweeperStats;
  config: {
    llm_base_url: string;
    default_model: string;
    models: string[];
    cache_ttl_s: number;
    max_tokens_cap: number;
  };
}

export interface SubmitResult {
  job_id: string;
  status: JobStatus;
  cached: boolean;
}

export interface ChatCompletion {
  id: string;
  model: string;
  choices: { index: number; message: { role: string; content: string }; finish_reason: string }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  x_gateway: { cached: boolean; request_id: string; provider?: string | null; ttft_ms?: number | null };
}

export interface StreamResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  x_gateway: { cached: boolean; request_id: string; provider: string | null; ttft_ms: number | null } | null;
}
