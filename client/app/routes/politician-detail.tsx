import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Briefcase, Building2, ClipboardList, FileText, Flag, Gift, Home, Plane, Vote, Wallet } from "lucide-react";
import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { DetailsList, IdentityBadge, ReviewBadge, SeverityBadge, StatTile, formatDate, titleCase, type DetailPair } from "../components/investigator";

type Row = { id: string; details?: DetailPair[] | null };
type Investment = Row & { entityName: string; fairMarketValue: string | null; natureOfInvestment: string | null };
type Position = Row & { entityName: string; businessPosition: string | null; fairMarketValue: string | null; natureOfInvestment: string | null; grossIncomeRange: string | null };
type Property = Row & { propertyDescription: string | null; city: string | null; county: string | null; fairMarketValue: string | null; natureOfInterest: string | null };
type Payment = Row & { scheduleType: string; sourceName: string | null; amount: string | null };
type Filing = {
  id: string; filingYear: number; filedAt?: string | null; filerName?: string | null; originalFilename?: string | null; createdAt?: string | null;
  importMetadata?: { filing_type?: string; selection?: string; versions?: { filed_serial: number; filing_type: string }[]; schedule_sources?: { sheet: string; filing_type: string }[] } | null;
  investments: Investment[]; businessPositions: Position[]; realProperty: Property[]; income: Payment[]; gifts: Payment[]; travel: Payment[];
};
type Conflict = { id: string; conflictType: string; severity: string; entityName: string | null; reviewStatus?: string; meetingDate?: string | null; filingYear?: number | null; agendaItem: { id: string; title: string | null; meetingDate: string | null; cityName?: string | null } };
type ReviewEvent = { id: string; action: string; createdAt: string; details?: unknown };
type VoteRow = { id: string; vote: string; voteDate: string | null; agendaItem: { id: string; title: string | null } };
export type Dossier = {
  id: string; slug?: string; fullName: string; officeTitle?: string | null; party?: string | null; district: string | null; createdAt?: string;
  jurisdiction?: { name: string; type: string } | null; identityVerified?: boolean;
  filings: Filing[]; conflicts: Conflict[]; votes?: VoteRow[]; reviewEvents?: ReviewEvent[];
  summary?: { disclosures: Record<string, number>; conflicts: { total: number; pending: number; high: number } };
};

const SCHEDULES = [
  { key: "investments", title: "Schedule A-1 · Investments", Icon: Wallet, name: (row: Investment) => row.entityName, facts: (row: Investment) => [row.fairMarketValue, row.natureOfInvestment] },
  { key: "businessPositions", title: "Schedule A-2 · Business entities & trusts", Icon: Briefcase, name: (row: Position) => row.entityName, facts: (row: Position) => [row.businessPosition, row.fairMarketValue, row.grossIncomeRange && `Income ${row.grossIncomeRange}`] },
  { key: "realProperty", title: "Schedule B · Real property", Icon: Home, name: (row: Property) => row.propertyDescription ?? "Property", facts: (row: Property) => [row.city, row.fairMarketValue, row.natureOfInterest] },
  { key: "income", title: "Schedule C · Income, loans & business positions", Icon: Building2, name: (row: Payment) => row.sourceName ?? "Source", facts: (row: Payment) => [row.amount] },
  { key: "gifts", title: "Schedule D · Gifts", Icon: Gift, name: (row: Payment) => row.sourceName ?? "Source", facts: (row: Payment) => [row.amount && `Value ${row.amount}`] },
  { key: "travel", title: "Schedule E · Travel payments", Icon: Plane, name: (row: Payment) => row.sourceName ?? "Source", facts: (row: Payment) => [row.amount && `Amount ${row.amount}`] },
] as const;

function DisclosureRow({ name, facts, details }: { name: string; facts: (string | null | undefined | false)[]; details?: DetailPair[] | null }) {
  const [open, setOpen] = useState(false);
  const summary = facts.filter(Boolean).join(" · ");
  return <li className="py-3">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-start justify-between gap-4 text-left">
      <span><span className="font-semibold text-slate-950">{name}</span>{summary && <span className="mt-0.5 block text-sm text-slate-600">{summary}</span>}</span>
      <span className="shrink-0 text-xs font-semibold text-blue-700">{open ? "Hide" : "All columns"}</span>
    </button>
    {open && <div className="mt-3 rounded-lg bg-slate-50 p-4"><DetailsList details={details} empty="This filing was imported before full-row capture; re-parse it to show every column." /></div>}
  </li>;
}

function FilingCard({ filing }: { filing: Filing }) {
  const total = SCHEDULES.reduce((sum, schedule) => sum + filing[schedule.key].length, 0);
  const meta = filing.importMetadata;
  return <article className="surface p-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
      <div><p className="eyebrow">Form 700</p><h3 className="mt-1 text-2xl font-bold">{filing.filingYear} statement</h3>
        <p className="mt-1 text-sm text-slate-600">{[meta?.filing_type, filing.filedAt && `filed ${formatDate(filing.filedAt)}`, filing.filerName && `as “${filing.filerName}”`].filter(Boolean).join(" · ")}</p></div>
      <div className="text-right text-xs text-slate-500"><p>{total} disclosure{total === 1 ? "" : "s"}</p>{filing.originalFilename && <p className="mt-1 max-w-xs truncate" title={filing.originalFilename}>Source: {filing.originalFilename}</p>}{(meta?.versions?.length ?? 0) > 1 && <p className="mt-1 text-amber-800">{meta!.versions!.length} submissions — amendments applied per schedule</p>}</div>
    </header>
    {total === 0 && <p className="mt-4 text-sm text-slate-600">No reportable interests were disclosed on this statement.</p>}
    <div className="mt-2 divide-y divide-slate-100">{SCHEDULES.map((schedule) => {
      const rows = filing[schedule.key] as never[];
      if (!rows.length) return null;
      const { Icon } = schedule;
      return <section key={schedule.key} className="py-4" aria-label={schedule.title}>
        <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500"><Icon size={16} aria-hidden="true" />{schedule.title} <span className="font-normal">({rows.length})</span></h4>
        <ul className="divide-y divide-slate-100">{rows.map((row: Row) => <DisclosureRow key={row.id} name={(schedule.name as (r: never) => string)(row as never)} facts={(schedule.facts as (r: never) => (string | null)[])(row as never)} details={row.details} />)}</ul>
      </section>;
    })}</div>
  </article>;
}

export function meta() { return [{ title: "Official | FAIR Investigations" }]; }

export default function PoliticianDetail() {
  const { id } = useParams();
  const { data: politician, loading, error, retry } = useApiData<Dossier>(`/api/politicians/${encodeURIComponent(id ?? "")}`);
  if (loading) return <div className="page-shell"><div className="surface p-8 text-slate-600" role="status">Loading official…</div></div>;
  if (error || !politician) return <div className="page-shell"><RequestError message={error || "Record not found."} onRetry={retry} /></div>;
  const conflicts = politician.conflicts ?? [];
  const disclosures = politician.summary?.disclosures ?? {};
  const disclosureTotal = Object.values(disclosures).reduce((sum, value) => sum + value, 0);

  return <div className="page-shell">
    <Link to="/politicians" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16} /> Officials</Link>
    <header className="mt-7 border-b border-slate-200 pb-8">
      <div className="flex flex-wrap items-center gap-2"><IdentityBadge verified={politician.identityVerified} />{politician.identityVerified === false && <Link to="/admin/politicians" className="text-xs font-semibold text-blue-700">Verify on Identity review →</Link>}</div>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">{politician.fullName}</h1>
      <p className="mt-2 text-lg text-slate-700">{[politician.officeTitle, politician.jurisdiction?.name, politician.district && `District ${politician.district}`, politician.party].filter(Boolean).join(" · ") || "Office not recorded"}</p>
      <p className="mt-2 text-xs text-slate-500">Record created {formatDate(politician.createdAt)} · ID {politician.id}</p>
    </header>

    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
      <StatTile label="Form 700 statements" value={politician.filings.length} hint={politician.filings.map((filing) => filing.filingYear).join(", ") || "None on file"} />
      <StatTile label="Reported interests" value={disclosureTotal} hint={Object.entries(disclosures).filter(([, count]) => count).map(([key, count]) => `${count} ${titleCase(key).toLowerCase()}`).join(", ") || "None"} />
      <StatTile label="Candidate conflicts" value={politician.summary?.conflicts.total ?? conflicts.length} hint={`${politician.summary?.conflicts.high ?? 0} high severity`} tone={(politician.summary?.conflicts.high ?? 0) > 0 ? "alert" : "default"} />
      <StatTile label="Awaiting review" value={politician.summary?.conflicts.pending ?? 0} />
    </section>

    <div className="mt-10 grid gap-8 xl:grid-cols-[1.5fr_1fr]">
      <section aria-labelledby="filings-heading">
        <div className="flex items-center gap-2"><FileText size={20} className="text-blue-700" /><h2 id="filings-heading" className="text-xl font-bold">Financial disclosures</h2></div>
        <p className="mt-1 text-sm text-slate-600">Every interest reported on each statement. Expand a line to see every column from the original filing (addresses, business activity, dates, tenants, lenders, gift descriptions…).</p>
        <div className="mt-4 space-y-6">{politician.filings.length === 0 ? <div className="surface p-5 text-sm text-slate-600">No Form 700 statements are on file.</div> : politician.filings.map((filing) => <FilingCard key={filing.id} filing={filing} />)}</div>
      </section>

      <aside className="space-y-8">
        <section aria-labelledby="flags-heading">
          <div className="flex items-center gap-2"><Flag size={20} className="text-blue-700" /><h2 id="flags-heading" className="text-xl font-bold">Candidate conflicts</h2></div>
          <div className="mt-4 space-y-3">{conflicts.length === 0 ? <div className="surface p-5 text-sm text-slate-600">No flags are linked to this official.</div> : conflicts.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group block p-4 transition hover:border-blue-300">
            <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={conflict.severity} /><span className="text-xs font-semibold uppercase text-slate-500">{titleCase(conflict.conflictType)}</span><ReviewBadge status={conflict.reviewStatus} /></div>
            <p className="mt-2 font-semibold group-hover:text-blue-800">{conflict.entityName ?? "Matched interest"}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{conflict.agendaItem.title ?? "Agenda item"}</p>
            <p className="mt-1 text-xs text-slate-500">Meeting {formatDate(conflict.meetingDate ?? conflict.agendaItem.meetingDate)}{conflict.filingYear ? ` · ${conflict.filingYear} Form 700` : ""}</p>
          </Link>)}</div>
        </section>

        {(politician.votes?.length ?? 0) > 0 && <section aria-labelledby="votes-heading">
          <div className="flex items-center gap-2"><Vote size={20} className="text-blue-700" /><h2 id="votes-heading" className="text-xl font-bold">Recorded votes</h2></div>
          <ul className="surface mt-4 divide-y divide-slate-100">{politician.votes!.map((vote) => <li key={vote.id} className="p-4 text-sm"><p className="font-semibold">{vote.vote}</p><Link to={`/agenda/${vote.agendaItem.id}`} className="text-slate-600 hover:text-blue-800">{vote.agendaItem.title ?? "Agenda item"}</Link><p className="text-xs text-slate-500">{formatDate(vote.voteDate)}</p></li>)}</ul>
        </section>}

        <section aria-labelledby="audit-heading">
          <div className="flex items-center gap-2"><ClipboardList size={20} className="text-blue-700" /><h2 id="audit-heading" className="text-xl font-bold">Identity audit trail</h2></div>
          {(politician.reviewEvents?.length ?? 0) === 0 ? <p className="surface mt-4 p-4 text-sm text-slate-600">No identity approvals or merges recorded.</p>
            : <ol className="surface mt-4 divide-y divide-slate-100">{politician.reviewEvents!.map((event) => <li key={event.id} className="p-4 text-sm"><p className="font-semibold">{titleCase(event.action)}</p><p className="text-xs text-slate-500">{formatDate(event.createdAt, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></li>)}</ol>}
        </section>
      </aside>
    </div>
  </div>;
}
