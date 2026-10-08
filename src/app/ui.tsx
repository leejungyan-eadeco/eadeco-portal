// Shared building blocks. No "use client": usable from server and client components.
import { todayMY } from "@/lib/schedule";
import { GuideButton, type GuideKey } from "./guide";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  secondary:
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-subtle active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  small:
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-subtle active:translate-y-px",
  icon: "inline-flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-subtle hover:text-ink",
};

// No width: form fields stretch inside their grid / flex column; filters size to content.
export const field =
  "min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-subtle disabled:text-ink-2";

export const panel = "overflow-hidden rounded-xl border border-line bg-surface";
export const th = "px-4 py-2.5 text-left text-xs font-medium text-ink-3 whitespace-nowrap";
export const td = "px-4 py-3 align-middle";
export const num = "text-right tabular-nums whitespace-nowrap";

export function PageHeader({ title, description, actions, guide }: { title: string; description: React.ReactNode; actions?: React.ReactNode; guide?: GuideKey }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[65ch]">
        <h1 className="font-display text-[28px] font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-2">{description}</p>
      </div>
      {(actions || guide) && (
        <div className="flex items-center gap-2">
          {guide && <GuideButton guide={guide} />}
          {actions}
        </div>
      )}
    </div>
  );
}

// as="div" for searchable selects: inside a <label>, clicking a menu option would re-focus the field.
export function Field({ label, hint, required, children, as: Tag = "label" }: { label: string; hint?: string; required?: boolean; children: React.ReactNode; as?: "label" | "div" }) {
  return (
    <Tag className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </Tag>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{hint}</p>
    </div>
  );
}

// Bordered badge, same shape as the e-invoice module's status badges.
const tones = {
  good: "border-good/25 bg-good-soft text-good",
  warn: "border-warn/25 bg-warn-soft text-warn",
  bad: "border-bad/25 bg-bad-soft text-bad",
  info: "border-info/25 bg-info-soft text-info",
  gold: "border-accent/30 bg-accent-soft text-accent-ink",
  neutral: "border-line-strong bg-subtle text-ink-3",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]} ${className}`}>{children}</span>;
}

const statusTone: Record<string, Tone> = {
  Active: "good",
  Created: "good",
  Admin: "gold",
  User: "info",
  Queued: "info",
  Processing: "info",
  "Not run": "neutral",
  "Deleted in NAV": "neutral",
  Paused: "warn",
  Failed: "bad",
  "Will retry": "warn",
  Resolved: "neutral",
  Ended: "neutral",
  Inactive: "neutral",
};

export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone[status] ?? "neutral"}>{status}</Badge>;

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const rm = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Plain string parsing so server and browser always agree (no timezone shifts).
export const fmtDate = (d: string) => `${Number(d.slice(8, 10))} ${months[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const fmtDateTime = (d: string) => `${fmtDate(d)}, ${d.slice(11, 16)}`;

export function daysFromToday(d: string) {
  return Math.round((Date.parse(d.slice(0, 10)) - Date.parse(todayMY())) / 864e5);
}

export function relativeDay(d: string) {
  const n = daysFromToday(d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 14) return `In ${n} days`;
  if (n === -1) return "Yesterday";
  if (n < 0) return `${-n} days ago`;
  return n < 45 ? `In ${Math.round(n / 7)} weeks` : `In ${Math.round(n / 30)} months`;
}
