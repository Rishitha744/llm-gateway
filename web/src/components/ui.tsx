import clsx from "clsx";
import { Check, Copy, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { JobStatus } from "@/lib/types";

export const cx = clsx;

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("animate-spin", className ?? "h-4 w-4")} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-raised", className)} />;
}

const STATUS_STYLE: Record<JobStatus | "cached", string> = {
  queued: "text-muted bg-raised border-line",
  processing: "text-info bg-info/10 border-info/25",
  done: "text-ok bg-ok/10 border-ok/25",
  failed: "text-bad bg-bad/10 border-bad/25",
  cached: "text-cache bg-cache/10 border-cache/25",
};

export function StatusBadge({ status, cached }: { status: JobStatus; cached?: boolean }) {
  const key = cached && status === "done" ? "cached" : status;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLE[key])}>
      <span className={cx("h-1.5 w-1.5 rounded-full bg-current", status === "processing" && "animate-pulse")} />
      {key === "cached" ? "cache hit" : status}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "ok" | "bad" | "warn" | "accent" | "info"; className?: string }) {
  const tones = {
    neutral: "text-muted bg-raised border-line",
    ok: "text-ok bg-ok/10 border-ok/25",
    bad: "text-bad bg-bad/10 border-bad/25",
    warn: "text-warn bg-warn/10 border-warn/25",
    accent: "text-accent bg-accent/10 border-accent/25",
    info: "text-info bg-info/10 border-info/25",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-raised p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 h-7 text-xs" : "px-3.5 h-8 text-sm",
            value === o.value ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cx(label ? "btn-outline h-8 px-2.5 text-xs" : "btn-ghost h-7 w-7 px-0", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      aria-label="Copy to clipboard"
      title="Copy"
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

export function CodeBlock({ code, className, lang }: { code: string; className?: string; lang?: string }) {
  return (
    <div className={cx("relative group rounded-lg border border-line bg-bg", className)}>
      {lang && <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-faint font-semibold">{lang}</div>}
      <CopyButton text={code} className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100" />
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed font-mono text-fg/90"><code>{code}</code></pre>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && <div className="mb-3 rounded-xl border border-line bg-raised p-3 text-muted">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="text-sm text-muted mt-1 max-w-sm">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal className={cx("relative w-full card animate-fade-in", width)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="btn-ghost h-7 w-7 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line bg-raised/40 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-panel border-l border-line shadow-2xl animate-slide-in flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-line shrink-0">
          <div className="min-w-0 text-sm font-semibold truncate">{title}</div>
          <div className="flex items-center gap-1">
            {actions}
            <button className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

// ---- toasts
type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx("card px-4 py-2.5 text-sm animate-fade-in flex items-center gap-2 min-w-[240px]",
            t.tone === "bad" && "border-bad/40", t.tone === "ok" && "border-ok/40")}>
            <span className={cx("h-2 w-2 rounded-full", t.tone === "ok" ? "bg-ok" : t.tone === "bad" ? "bg-bad" : "bg-info")} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint mt-1.5">{hint}</span>}
    </label>
  );
}

export function Dot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {ok && <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-50 animate-ping" />}
      <span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", ok ? "bg-ok" : "bg-bad")} />
    </span>
  );
}
