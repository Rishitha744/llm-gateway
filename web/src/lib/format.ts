const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");

export const num = (n: number | null | undefined) => (n == null ? "—" : n >= 10_000 ? compact.format(n) : whole.format(n));

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : `${(x * 100).toFixed(x > 0 && x < 0.001 ? 2 : digits)}%`;

export function ms(v: number | null | undefined) {
  if (v == null) return "—";
  if (v < 1) return "<1 ms";
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(v / 60_000)}m ${Math.round((v % 60_000) / 1000)}s`;
}

export function duration(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 5) return "just now";
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

export function bucketLabel(iso: string, bucketSeconds: number) {
  const d = new Date(iso);
  if (bucketSeconds <= 3600) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit" });
}

export const shortId = (id: string) => id.slice(0, 8);
