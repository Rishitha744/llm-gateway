import { getSession } from "./session";
import { mockFetch } from "./mock";
import type {
  AdminOverview, ApiKey, ChatCompletion, Job, Me, Page, RangeKey, SubmitResult,
  StreamResult, SystemSnapshot, Tenant, Usage,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public headers?: Headers) {
    super(message);
  }
}

export interface Meta {
  status: number;
  headers: Record<string, string>;
  ms: number;
}

type Auth = "tenant" | "admin" | "none";
interface CallOpts { method?: string; body?: unknown; auth?: Auth; token?: string; headers?: Record<string, string> }

function send(path: string, { method = "GET", body, auth = "tenant", token, headers: extra }: CallOpts) {
  const s = getSession();
  const headers: Record<string, string> = { Accept: "application/json", ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth === "tenant") headers.Authorization = `Bearer ${token ?? s.apiKey ?? ""}`;
  if (auth === "admin") headers["X-Admin-Token"] = token ?? s.adminToken ?? "";
  const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  return s.demo ? mockFetch(path, init) : fetch(path, init);
}

function errorFrom(status: number, json: unknown, headers?: Headers) {
  const j = json as { detail?: unknown; error?: { message?: string } } | null;
  const detail = j?.error?.message ?? j?.detail;
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d.msg).join("; ")
        : `Request failed (${status})`;
  return new ApiError(status, message, headers);
}

function headerMap(res: Response) {
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
  return h;
}

/** POST /v1/chat/completions with stream=true; calls onDelta for each token chunk. */
async function chatStream(
  body: { messages: { role: string; content: string }[]; model?: string; max_tokens?: number },
  onDelta: (text: string, ttftMs: number) => void,
): Promise<{ data: StreamResult; meta: Meta }> {
  const started = performance.now();
  const res = await send("/v1/chat/completions", { method: "POST", body: { ...body, stream: true } });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    throw errorFrom(res.status, json, res.headers);
  }
  const out: StreamResult = { content: "", usage: null, x_gateway: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstAt: number | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!frame.startsWith("data: ")) continue;
      const data = frame.slice(6).trim();
      if (data === "[DONE]") continue;
      const evt = JSON.parse(data);
      if (evt.error) throw new ApiError(502, evt.error.message);
      if (evt.usage) out.usage = evt.usage;
      if (evt.x_gateway) out.x_gateway = evt.x_gateway;
      const text = evt.choices?.[0]?.delta?.content;
      if (text) {
        firstAt ??= performance.now();
        out.content += text;
        onDelta(text, Math.round(firstAt - started));
      }
    }
  }
  return { data: out, meta: { status: res.status, headers: headerMap(res), ms: Math.round(performance.now() - started) } };
}

async function call<T>(
  path: string,
  opts: CallOpts = {},
): Promise<{ data: T; meta: Meta }> {
  const started = performance.now();
  const res = await send(path, opts);
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw errorFrom(res.status, json, res.headers);
  return { data: json as T, meta: { status: res.status, headers: headerMap(res), ms } };
}

const get = async <T>(path: string, auth: Auth = "tenant") => (await call<T>(path, { auth })).data;

function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface JobFilters {
  status?: string;
  q?: string;
  before?: string;
  tenant_id?: number;
  limit?: number;
}

export const api = {
  // Tenant
  me: (token?: string) => call<Me>("/v1/me", { token }).then((r) => r.data),
  models: () => get<{ data: { id: string }[] }>("/v1/models"),
  usage: (range: RangeKey) => get<Usage>(`/v1/usage${qs({ range })}`),
  jobs: (f: JobFilters) => get<Page<Job>>(`/v1/jobs${qs({ ...f })}`),
  job: (id: string) => get<Job>(`/v1/jobs/${id}`),
  submitJob: (body: { prompt: string; model?: string; max_tokens?: number }, idempotencyKey?: string) =>
    call<SubmitResult>("/v1/jobs", {
      method: "POST", body, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
  chatStream,
  chat: (body: { messages: { role: string; content: string }[]; model?: string; max_tokens?: number }) =>
    call<ChatCompletion>("/v1/chat/completions", { method: "POST", body }),
  keys: () => get<{ data: ApiKey[]; current_key_id: number }>("/v1/keys"),
  createKey: (name: string) => call<ApiKey>("/v1/keys", { method: "POST", body: { name } }).then((r) => r.data),
  revokeKey: (id: number) => call<ApiKey>(`/v1/keys/${id}`, { method: "DELETE" }).then((r) => r.data),

  // Admin
  whoami: (token?: string) => call<{ role: string }>("/admin/whoami", { auth: "admin", token }).then((r) => r.data),
  overview: (range: RangeKey) => get<AdminOverview>(`/admin/overview${qs({ range })}`, "admin"),
  tenants: () => get<{ data: Tenant[] }>("/admin/tenants", "admin"),
  tenant: (id: number, range: RangeKey = "24h") =>
    get<{ tenant: Tenant; keys: ApiKey[]; usage: Usage }>(`/admin/tenants/${id}${qs({ range })}`, "admin"),
  createTenant: (body: { name: string; rate_limit_per_min: number }) =>
    call<{ tenant: Tenant; api_key: ApiKey }>("/admin/tenants", { method: "POST", body, auth: "admin" }).then((r) => r.data),
  updateTenant: (id: number, body: { rate_limit_per_min?: number; is_active?: boolean }) =>
    call<Tenant>(`/admin/tenants/${id}`, { method: "PATCH", body, auth: "admin" }).then((r) => r.data),
  createTenantKey: (id: number, name: string) =>
    call<ApiKey>(`/admin/tenants/${id}/keys`, { method: "POST", body: { name }, auth: "admin" }).then((r) => r.data),
  adminRevokeKey: (id: number) => call<ApiKey>(`/admin/keys/${id}`, { method: "DELETE", auth: "admin" }).then((r) => r.data),
  adminJobs: (f: JobFilters) => get<Page<Job>>(`/admin/jobs${qs({ ...f })}`, "admin"),
  adminJob: (id: string) => get<Job>(`/admin/jobs/${id}`, "admin"),
  retryJob: (id: string) => call<SubmitResult>(`/admin/jobs/${id}/retry`, { method: "POST", auth: "admin" }).then((r) => r.data),
  system: () => get<SystemSnapshot>("/admin/system", "admin"),
};
