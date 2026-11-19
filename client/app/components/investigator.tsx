import type { ReactNode } from "react";
import { BadgeCheck, CircleAlert, Database, FileClock, FileText, FileUp, Flag, Gauge, Landmark, UsersRound } from "lucide-react";

export type DetailPair = { label: string; value: string };

/** One navigation model for every signed-in page. */
export const investigatorLinks = [
  { to: "/", label: "Dashboard", Icon: Gauge, end: true },
  { to: "/conflicts", label: "Conflicts", Icon: Flag, end: false },
  { to: "/politicians", label: "Officials", Icon: Landmark, end: false },
  { to: "/admin/upload", label: "Upload", Icon: FileUp, end: false },
  { to: "/admin/sources", label: "Sources", Icon: Database, end: false },
  { to: "/admin/reports", label: "Reports", Icon: FileText, end: false },
  { to: "/admin/history", label: "History", Icon: FileClock, end: false },
];
export const ownerLinks = [{ to: "/admin/users", label: "Users", Icon: UsersRound, end: false }];

export const titleCase = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : parsed.toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

const SEVERITY_CLASS: Record<string, string> = {
  HIGH: "bg-red-50 text-red-800 ring-red-200",
  MEDIUM: "bg-amber-50 text-amber-800 ring-amber-200",
  LOW: "bg-blue-50 text-blue-800 ring-blue-200",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const key = severity.toUpperCase();
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${SEVERITY_CLASS[key] ?? SEVERITY_CLASS.LOW}`}>{key}</span>;
}

const REVIEW_LABEL: Record<string, [string, string]> = {
  pending: ["Awaiting review", "bg-slate-100 text-slate-700 ring-slate-200"],
  confirmed_conflict: ["Confirmed conflict", "bg-red-600 text-white ring-red-600"],
  not_applicable: ["Not applicable", "bg-emerald-50 text-emerald-800 ring-emerald-200"],
};

export function ReviewBadge({ status }: { status: string | null | undefined }) {
  const [text, className] = REVIEW_LABEL[status ?? "pending"] ?? REVIEW_LABEL.pending;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}>{text}</span>;
}

/** Imported filers stay unverified until an admin confirms the identity match. */
export function IdentityBadge({ verified }: { verified: boolean | null | undefined }) {
  if (verified == null) return null;
  return verified
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"><BadgeCheck size={13} aria-hidden="true" />Identity verified</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200" title="This filer was created by a Form 700 import and has not been confirmed on Admin → Officials."><CircleAlert size={13} aria-hidden="true" />Identity unverified</span>;
}

/** Every column FAIR retained from the original Form 700 row. */
export function DetailsList({ details, empty = "No additional columns were reported." }: { details: DetailPair[] | null | undefined; empty?: string }) {
  if (!details?.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{details.map(({ label, value }, index) => <div key={`${label}-${index}`} className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titleCase(label)}</dt><dd className="break-words text-sm text-slate-900">{value}</dd></div>)}</dl>;
}

export function StatTile({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "alert" }) {
  return <div className={`surface p-5 ${tone === "alert" ? "border-red-200" : ""}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-bold tabular-nums ${tone === "alert" ? "text-red-700" : "text-slate-950"}`}>{value}</p>{hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}</div>;
}
