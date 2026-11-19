import { Link } from "react-router";
import { ArrowRight, Database, Flag, Landmark } from "lucide-react";
import { useApiPayload, useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { IdentityBadge, SeverityBadge, StatTile, formatDate, titleCase } from "../components/investigator";

type ConflictRow = { id: string; politicianId: string | null; politicianName: string; city: string; conflictType: string; severity: string; agendaItemSummary: string; entityName: string | null; meetingDate: string | null; detectedAt: string; identityVerified: boolean | null };
type Page = { data: ConflictRow[]; total: number };
type Official = { id: string; slug?: string; fullName: string; officeTitle: string | null; jurisdiction: string | null; identityVerified: boolean | null; conflictCount: number; disclosureCount: number };
type Source = { id: string; cityName: string; sourceType: string; enabled: boolean; lastSyncTime: string | null; lastError: string | null; totalAgendaItems: number; status: string };

export function meta() {
  return [{ title: "Dashboard | FAIR Investigations" }];
}

export default function Home() {
  const queue = useApiPayload<Page>("/api/conflicts?reviewStatus=pending&sort=severity&pageSize=10");
  const highPending = useApiPayload<Page>("/api/conflicts?reviewStatus=pending&severities=HIGH&pageSize=1");
  const all = useApiPayload<Page>("/api/conflicts?pageSize=1");
  const officials = useApiData<Official[]>("/api/politicians?limit=500");
  const sources = useApiPayload<Source[]>("/api/admin/sources");
  const unverified = (officials.data ?? []).filter((official) => official.identityVerified === false);
  const sourceRows = Array.isArray(sources.data) ? sources.data : [];
  const failing = sourceRows.filter((source) => source.enabled && source.lastError);

  return <div className="page-shell">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Investigator workspace</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Dashboard</h1><p className="mt-3 max-w-2xl text-slate-600">Candidate conflicts between Form 700 disclosures and agenda items, ordered for review. Each flag is a lead, not a finding.</p></div>
      <Link to="/conflicts?reviewStatus=pending&sort=severity" className="button-primary">Open review queue <ArrowRight size={17} /></Link>
    </header>

    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Case load">
      <StatTile label="Awaiting review" value={queue.data?.total ?? "—"} hint="Pending candidate conflicts" />
      <StatTile label="High severity pending" value={highPending.data?.total ?? "—"} hint="Reported value $10,000 or more" tone={(highPending.data?.total ?? 0) > 0 ? "alert" : "default"} />
      <StatTile label="All active flags" value={all.data?.total ?? "—"} hint="Across every jurisdiction" />
      <StatTile label="Unverified filers" value={officials.data ? unverified.length : "—"} hint="Confirm identity on Identity review" />
    </section>

    <div className="mt-10 grid gap-8 xl:grid-cols-[1.6fr_1fr]">
      <section aria-labelledby="queue-heading">
        <div className="flex items-center gap-2"><Flag size={19} className="text-blue-700" /><h2 id="queue-heading" className="text-xl font-bold">Review queue</h2></div>
        {queue.error && <RequestError message={queue.error} onRetry={queue.retry} />}
        {queue.loading && <div className="surface mt-4 p-6 text-slate-600" role="status">Loading review queue…</div>}
        {!queue.loading && !queue.error && (queue.data?.data.length ?? 0) === 0 && <div className="surface mt-4 p-8 text-center"><h3 className="font-semibold">Nothing awaiting review</h3><p className="mt-2 text-sm text-slate-600">New candidates appear after agenda syncs and Form 700 imports.</p></div>}
        <ol className="mt-4 space-y-3">{(queue.data?.data ?? []).map((conflict) => <li key={conflict.id}><Link to={`/conflicts/${conflict.id}`} className="surface group block p-5 transition hover:border-blue-300">
          <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={conflict.severity} /><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titleCase(conflict.conflictType)}</span><IdentityBadge verified={conflict.identityVerified} /></div>
          <h3 className="mt-3 font-semibold group-hover:text-blue-800">{conflict.politicianName} <span className="font-normal text-slate-500">· {conflict.city}</span></h3>
          {conflict.entityName && <p className="mt-1 text-sm"><span className="text-slate-500">Matched:</span> <strong>{conflict.entityName}</strong></p>}
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{conflict.agendaItemSummary}</p>
          <p className="mt-2 text-xs text-slate-500">Meeting {formatDate(conflict.meetingDate)}</p>
        </Link></li>)}</ol>
      </section>

      <div className="space-y-8">
        <section aria-labelledby="identity-heading">
          <div className="flex items-center gap-2"><Landmark size={19} className="text-blue-700" /><h2 id="identity-heading" className="text-xl font-bold">Filers to verify</h2></div>
          {officials.error && <RequestError message={officials.error} onRetry={officials.retry} />}
          <ul className="surface mt-4 divide-y divide-slate-100">{unverified.slice(0, 8).map((official) => <li key={official.id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><Link to={`/politicians/${encodeURIComponent(official.slug ?? official.id)}`} className="font-semibold hover:text-blue-800">{official.fullName}</Link><p className="truncate text-xs text-slate-500">{official.officeTitle ?? "Office not listed"} · {official.jurisdiction ?? "No jurisdiction"}</p></div><span className="shrink-0 text-xs text-slate-600">{official.conflictCount} flag{official.conflictCount === 1 ? "" : "s"}</span></li>)}
            {officials.data && unverified.length === 0 && <li className="p-4 text-sm text-slate-600">Every filer identity is verified.</li>}
          </ul>
          {unverified.length > 0 && <Link to="/admin/politicians" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">Open identity review <ArrowRight size={15} /></Link>}
        </section>

        <section aria-labelledby="sources-heading">
          <div className="flex items-center gap-2"><Database size={19} className="text-blue-700" /><h2 id="sources-heading" className="text-xl font-bold">Agenda sources</h2></div>
          {sources.error && <RequestError message={sources.error} onRetry={sources.retry} />}
          <ul className="surface mt-4 divide-y divide-slate-100">{sourceRows.map((source) => <li key={source.id} className="p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{source.cityName}</p><span className={`text-xs font-semibold ${!source.enabled ? "text-slate-400" : source.lastError ? "text-red-700" : "text-emerald-700"}`}>{!source.enabled ? "Disabled" : source.lastError ? "Needs attention" : "Healthy"}</span></div><p className="mt-1 text-xs text-slate-500">{titleCase(source.sourceType)} · {source.totalAgendaItems.toLocaleString()} items · last sync {formatDate(source.lastSyncTime)}</p></li>)}</ul>
          {failing.length > 0 && <Link to="/admin/sources" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-red-700">{failing.length} source{failing.length === 1 ? "" : "s"} reporting errors <ArrowRight size={15} /></Link>}
        </section>
      </div>
    </div>
  </div>;
}
