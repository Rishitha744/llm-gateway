import { ArrowRight, Database, Gauge, KeyRound, Layers, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ThemeToggle } from "@/components/Layout";
import { ErrorNote, Segmented, Spinner } from "@/components/ui";

const FEATURES = [
  { icon: KeyRound, title: "Multi-tenant API keys", text: "SHA-256 hashed keys, per-tenant quotas, self-service rotation." },
  { icon: Gauge, title: "Rate limiting", text: "Redis fixed-window limiter with standard X-RateLimit headers." },
  { icon: Database, title: "Response cache", text: "Tenant-scoped prompt cache cuts latency and token spend." },
  { icon: Layers, title: "Kafka job queue", text: "Async jobs partitioned by tenant, consumed by a worker fleet." },
  { icon: RefreshCw, title: "Retries + DLQ", text: "Exponential backoff with jitter; poison jobs land in a dead-letter topic." },
  { icon: ShieldCheck, title: "OpenAI-compatible", text: "Drop-in /v1/chat/completions for existing SDKs." },
];

export default function Login() {
  const s = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"tenant" | "admin">(s.apiKey && !s.demo ? "admin" : "tenant");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = value.trim();
      if (mode === "tenant") {
        await api.me(token);
        s.update(s.demo ? { apiKey: token, adminToken: null, demo: false } : { apiKey: token });
        navigate("/", { replace: true });
      } else {
        await api.whoami(token);
        s.update(s.demo ? { adminToken: token, apiKey: null, demo: false } : { adminToken: token });
        navigate("/ops", { replace: true });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-line p-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.5] [background:radial-gradient(60%_50%_at_20%_10%,rgb(var(--accent)/0.18),transparent_70%),radial-gradient(40%_40%_at_90%_90%,rgb(var(--cache)/0.10),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(var(--line)/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--line)/0.5)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="relative flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-accent grid place-items-center">
            <svg viewBox="0 0 32 32" className="h-4 w-4"><path d="M7 10h18M7 16h11M7 22h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><circle cx="23.5" cy="16" r="2.4" fill="#fff" /></svg>
          </div>
          <span className="font-semibold tracking-tight">LLM Gateway</span>
        </div>
        <div className="relative max-w-xl">
          <h1 className="text-4xl font-semibold tracking-tight leading-[1.1]">
            One front door for every<br />model call your team makes.
          </h1>
          <p className="mt-4 text-muted text-[15px] leading-relaxed">
            A production-style gateway that authenticates tenants, enforces quotas, caches responses and
            runs long prompts through a fault-tolerant Kafka pipeline, with full observability.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3">
                <f.icon className="h-4 w-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-xs text-muted mt-0.5 leading-relaxed">{f.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative font-mono text-[11px] text-faint">
          client → nginx → gateway ×N → redis · postgres · kafka → worker ×N → LLM
        </div>
      </section>

      <section className="flex flex-col p-6 sm:p-10">
        <div className="flex justify-end"><ThemeToggle /></div>
        <div className="m-auto w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Sign in to the console</h2>
          <p className="text-sm text-muted mt-1">Use a tenant API key, or an operator token for fleet administration.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Segmented
              size="md"
              value={mode}
              onChange={(v) => { setMode(v); setError(null); }}
              options={[{ value: "tenant", label: "Tenant API key" }, { value: "admin", label: "Operator token" }]}
            />
            <div>
              <label className="label" htmlFor="cred">{mode === "tenant" ? "API key" : "Admin token"}</label>
              <input
                id="cred"
                className="input font-mono"
                type="password"
                autoComplete="off"
                placeholder={mode === "tenant" ? "gw_…" : "ADMIN_TOKEN from .env"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>
            <ErrorNote error={error} />
            <button className="btn-primary w-full" disabled={!value.trim() || busy}>
              {busy ? <Spinner /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
            {(s.apiKey || s.adminToken) && (
              <p className="text-xs text-muted text-center">
                Already signed in as {s.apiKey ? "a tenant" : "operator"}. Adding the other credential unlocks both consoles.
              </p>
            )}
          </form>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint">
            <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
          </div>
          <button className="btn-outline w-full" onClick={() => s.update({ apiKey: "gw_demo", adminToken: "demo", demo: true })}>
            <Sparkles className="h-4 w-4 text-accent" /> Explore with demo data
          </button>
          <p className="text-xs text-faint mt-3 text-center">Runs entirely in your browser with a simulated backend.</p>
        </div>
      </section>
    </div>
  );
}
