import { useEffect, useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { bucketLabel, ms, num } from "@/lib/format";
import type { UsagePoint } from "@/lib/types";

/** Reads chart colors from CSS custom properties; re-reads when the theme class flips. */
function useChartColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      blue: v("--s-blue"), aqua: v("--s-aqua"), red: v("--s-red"), orange: v("--s-orange"),
      grid: v("--grid"), surface: `rgb(${v("--panel").split(" ").join(",")})`, faint: `rgb(${v("--faint").split(" ").join(",")})`,
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return c;
}

const axisProps = (faint: string) => ({
  tick: { fill: faint, fontSize: 11 },
  tickLine: false,
  axisLine: false,
});

interface TipRow { label: string; value: string; color?: string }
function TooltipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="card px-3 py-2 text-xs min-w-[160px] pointer-events-none">
      <div className="text-muted mb-1.5">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-mono text-fg tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
          {i.value != null && <span className="text-fg font-medium tabular-nums">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

type Datum = UsagePoint & { label: string; upstream: number };

function prep(series: UsagePoint[], bucketSeconds: number): Datum[] {
  return series.map((p) => ({
    ...p,
    label: bucketLabel(p.t, bucketSeconds),
    upstream: Math.max(0, p.total - p.cached - p.failed),
  }));
}

export function TrafficChart({ series, bucketSeconds, height = 240 }: { series: UsagePoint[]; bucketSeconds: number; height?: number }) {
  const c = useChartColors();
  const data = prep(series, bucketSeconds);
  return (
    <div className="space-y-3">
      <Legend items={[
        { label: "Served by model", color: c.blue },
        { label: "Cache hit", color: c.aqua },
        { label: "Failed", color: c.red },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.faint)} minTickGap={24} />
          <YAxis {...axisProps(c.faint)} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <TooltipBox title={new Date(d.t).toLocaleString()} rows={[
                  { label: "Total", value: num(d.total) },
                  { label: "Served by model", value: num(d.upstream), color: c.blue },
                  { label: "Cache hit", value: num(d.cached), color: c.aqua },
                  { label: "Failed", value: num(d.failed), color: c.red },
                  { label: "Rate-limited (rejected)", value: num(d.rate_limited) },
                ]} />
              );
            }}
          />
          {/* surface-colored stroke = 2px gap between stacked segments */}
          <Bar isAnimationActive={false} dataKey="upstream" stackId="a" fill={c.blue} stroke={c.surface} strokeWidth={1} />
          <Bar isAnimationActive={false} dataKey="cached" stackId="a" fill={c.aqua} stroke={c.surface} strokeWidth={1} />
          <Bar isAnimationActive={false} dataKey="failed" stackId="a" fill={c.red} stroke={c.surface} strokeWidth={1} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencyChart({ series, bucketSeconds, height = 200 }: { series: UsagePoint[]; bucketSeconds: number; height?: number }) {
  const c = useChartColors();
  const data = prep(series, bucketSeconds);
  // Sparse series (a quiet range) would draw no visible line, so show markers.
  const sparse = data.filter((d) => d.p50_ms != null).length < 4;
  const dot = (color: string) => (sparse ? { r: 4, fill: color, stroke: c.surface, strokeWidth: 2 } : false);
  return (
    <div className="space-y-3">
      <Legend items={[{ label: "p50", color: c.blue }, { label: "p95", color: c.orange }]} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.faint)} minTickGap={24} />
          <YAxis {...axisProps(c.faint)} width={52} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)} />
          <Tooltip
            cursor={{ stroke: c.faint, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <TooltipBox title={new Date(d.t).toLocaleString()} rows={[
                  { label: "p50", value: ms(d.p50_ms), color: c.blue },
                  { label: "p95", value: ms(d.p95_ms), color: c.orange },
                  { label: "Model calls", value: num(d.upstream) },
                ]} />
              );
            }}
          />
          <Line isAnimationActive={false} type="monotone" dataKey="p50_ms" stroke={c.blue} strokeWidth={2} dot={dot(c.blue)} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
          <Line isAnimationActive={false} type="monotone" dataKey="p95_ms" stroke={c.orange} strokeWidth={2} dot={dot(c.orange)} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SingleAreaChart({
  series, bucketSeconds, dataKey, label, format = num, height = 160, tone = "blue",
}: {
  series: UsagePoint[]; bucketSeconds: number; dataKey: keyof UsagePoint | "tokens"; label: string;
  format?: (n: number) => string; height?: number; tone?: "blue" | "orange";
}) {
  const c = useChartColors();
  const color = c[tone];
  const data = prep(series, bucketSeconds).map((d) => ({ ...d, tokens: d.prompt_tokens + d.completion_tokens }));
  const id = `grad-${String(dataKey)}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.faint)} minTickGap={28} />
        <YAxis {...axisProps(c.faint)} width={48} allowDecimals={false} tickFormatter={(v) => num(v)} />
        <Tooltip
          cursor={{ stroke: c.faint, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as Datum & { tokens: number };
            return <TooltipBox title={new Date(d.t).toLocaleString()} rows={[{ label, value: format(Number(d[dataKey as keyof typeof d] ?? 0)), color }]} />;
          }}
        />
        <Area isAnimationActive={false} type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Tiny inline trend for stat tiles. */
export function Sparkline({ values, tone = "blue" }: { values: number[]; tone?: "blue" | "orange" }) {
  const c = useChartColors();
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 64;
  const h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={c[tone]} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
