import {
  Activity, BookOpen, Boxes, FlaskConical, Gauge, KeyRound, LayoutDashboard, ListTree, LogOut, Menu, Moon, Plus,
  ServerCog, Skull, Sun, Users, X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEMO_ONLY, useSession } from "@/lib/session";
import { Badge, cx } from "./ui";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-7 w-7 rounded-lg bg-accent grid place-items-center shadow-[0_0_24px_-4px_rgb(var(--accent))]">
        <svg viewBox="0 0 32 32" className="h-4 w-4"><path d="M7 10h18M7 16h11M7 22h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><circle cx="23.5" cy="16" r="2.4" fill="#fff" /></svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">LLM Gateway</div>
        <div className="text-[10px] text-faint uppercase tracking-wider">Console</div>
      </div>
    </div>
  );
}

function NavItem({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-2.5 rounded-lg px-2.5 h-8 text-sm transition-colors",
          isActive ? "bg-raised text-fg font-medium" : "text-muted hover:text-fg hover:bg-raised/60",
        )
      }
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4 opacity-90">{icon}</span>
      {children}
    </NavLink>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{title}</div>
      {children}
    </div>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button className="btn-ghost h-8 w-8 px-0" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export default function Layout() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: !!s.apiKey, refetchInterval: 15_000 });
  const health = useQuery({
    queryKey: ["system"],
    queryFn: api.system,
    enabled: !!s.adminToken,
    refetchInterval: 10_000,
  });
  const allOk = health.data?.dependencies.every((d) => d.ok);

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 p-3">
      <div className="px-1.5 pt-1.5 pb-1 flex items-center justify-between">
        <Logo />
        <button className="btn-ghost h-8 w-8 px-0 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
      </div>
      {s.apiKey && (
        <Section title="Workspace">
          <NavItem to="/" end icon={<LayoutDashboard />}>Overview</NavItem>
          <NavItem to="/playground" icon={<FlaskConical />}>Playground</NavItem>
          <NavItem to="/requests" icon={<ListTree />}>Requests</NavItem>
          <NavItem to="/keys" icon={<KeyRound />}>API keys</NavItem>
          <NavItem to="/quickstart" icon={<BookOpen />}>Quickstart</NavItem>
        </Section>
      )}
      {s.adminToken && (
        <Section title="Operations">
          <NavItem to="/ops" end icon={<Gauge />}>Fleet overview</NavItem>
          <NavItem to="/ops/tenants" icon={<Users />}>Tenants</NavItem>
          <NavItem to="/ops/jobs" icon={<Boxes />}>All jobs</NavItem>
          <NavItem to="/ops/dlq" icon={<Skull />}>Dead letters</NavItem>
          <NavItem to="/ops/system" icon={<ServerCog />}>System health</NavItem>
        </Section>
      )}
      <div className="mt-auto space-y-3">
        {me.data && (
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Rate limit · this minute</span>
              <span className="font-mono tabular-nums">{me.data.rate_limit.used_this_minute}/{me.data.rate_limit.per_minute}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className={cx("h-full rounded-full transition-all", me.data.rate_limit.used_this_minute / me.data.rate_limit.per_minute > 0.85 ? "bg-warn" : "bg-accent")}
                style={{ width: `${Math.min(100, (me.data.rate_limit.used_this_minute / me.data.rate_limit.per_minute) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {!s.demo && (!s.apiKey || !s.adminToken) && (
          <NavLink to="/login?add=1" className="flex items-center gap-2.5 rounded-lg px-2.5 h-8 text-sm text-muted hover:text-fg hover:bg-raised/60">
            <Plus className="h-4 w-4" /> {s.apiKey ? "Connect operator console" : "Connect a tenant key"}
          </NavLink>
        )}
        <a href={s.demo ? "#" : "/docs"} target={s.demo ? undefined : "_blank"} rel="noreferrer"
          className={cx("flex items-center gap-2.5 rounded-lg px-2.5 h-8 text-sm text-muted hover:text-fg hover:bg-raised/60", s.demo && "pointer-events-none opacity-50")}>
          <Activity className="h-4 w-4" /> OpenAPI reference
        </a>
      </div>
    </nav>
  );

  return (
    <div className="min-h-full lg:pl-60">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 border-r border-line bg-panel/60 backdrop-blur">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-panel border-r border-line animate-fade-in">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-30 h-14 border-b border-line bg-bg/80 backdrop-blur flex items-center gap-3 px-4 lg:px-8">
        <button className="btn-ghost h-8 w-8 px-0 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 min-w-0">
          {me.data && (
            <>
              <span className="text-sm font-medium truncate">{me.data.tenant.name}</span>
              <span className="text-faint">/</span>
              <span className="font-mono text-xs text-muted truncate">{me.data.key.prefix}…</span>
            </>
          )}
          {!me.data && s.adminToken && <span className="text-sm font-medium">Operator</span>}
          {s.demo && <Badge tone="accent">Demo data</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {health.data && (
            <NavLink to="/ops/system" className="hidden sm:flex items-center gap-2 rounded-lg border border-line px-2.5 h-8 text-xs text-muted hover:text-fg mr-1">
              <span className={cx("h-2 w-2 rounded-full", allOk ? "bg-ok" : "bg-bad")} />
              {allOk ? "All systems operational" : "Degraded"}
            </NavLink>
          )}
          <ThemeToggle />
          {!DEMO_ONLY && (
            <button className="btn-ghost h-8 px-2.5" onClick={s.signOut} title="Sign out">
              <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </header>
      <main className="px-4 py-6 lg:px-8 lg:py-8 max-w-[1400px] animate-fade-in motion-reduce:animate-none" key={loc.pathname}>
        <Outlet />
      </main>
    </div>
  );
}
