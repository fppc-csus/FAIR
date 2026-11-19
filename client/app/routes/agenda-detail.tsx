import { Link, useParams } from "react-router";
import { ArrowLeft, CalendarDays, ExternalLink, Flag, Landmark, MapPin, Paperclip, Vote } from "lucide-react";
import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { SeverityBadge, formatDate, titleCase } from "../components/investigator";

type Conflict = { id: string; conflictType: string; severity: string; entityName: string | null; ruleReference: string; politician: { id: string; fullName: string; district: string | null } };
type RollCall = { personName: string; value: string };
type AgendaItem = {
  id: string; title: string | null; description: string | null; itemText: string | null; itemNumber: string | null; agendaNumber?: string | null;
  meetingDate: string | null; cityName: string | null; sourceType: string; bodyName: string | null; sourceUrl?: string | null;
  conflicts: Conflict[]; rollCall?: RollCall[]; attachments?: { name: string; url: string | null }[];
  votes?: { vote: string; politician: { id: string; slug: string | null; fullName: string } }[];
};

export function meta() { return [{ title: "Agenda item | FAIR Investigations" }]; }

export default function AgendaDetail() {
  const { id } = useParams();
  const { data: item, loading, error, retry } = useApiData<AgendaItem>(`/api/agenda/${encodeURIComponent(id ?? "")}`);
  if (loading) return <div className="page-shell"><div className="surface p-8 text-slate-600" role="status">Loading agenda item…</div></div>;
  if (error || !item) return <div className="page-shell"><RequestError message={error || "Record not found."} onRetry={retry} /></div>;
  const profiles = new Map((item.votes ?? []).map((vote) => [vote.politician.fullName.split(" ").filter((_, index, all) => index === 0 || index === all.length - 1).join(" ").toLowerCase(), vote.politician]));
  const number = item.agendaNumber ?? item.itemNumber;

  return <div className="page-shell">
    <Link to="/conflicts" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16} /> Conflicts</Link>
    <header className="mt-7 max-w-4xl">
      <p className="eyebrow">Agenda item {number ? `· ${number}` : ""}</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{item.title ?? "Untitled agenda item"}</h1>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm text-slate-600">
        {item.meetingDate && <span className="inline-flex items-center gap-2"><CalendarDays size={16} />{formatDate(item.meetingDate, { year: "numeric", month: "long", day: "numeric" })}</span>}
        {item.cityName && <span className="inline-flex items-center gap-2"><MapPin size={16} />{item.cityName}</span>}
        {item.bodyName && <span className="inline-flex items-center gap-2"><Landmark size={16} />{item.bodyName}</span>}
        {item.sourceUrl && <a className="inline-flex items-center gap-1 font-semibold text-blue-700" href={item.sourceUrl} target="_blank" rel="noreferrer">Original agenda <ExternalLink size={14} /></a>}
      </div>
    </header>

    <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_0.6fr]">
      <section className="surface p-6 sm:p-8" aria-labelledby="text-heading">
        <h2 id="text-heading" className="text-xl font-bold">Agenda text</h2>
        <p className="mt-5 max-h-[40rem] overflow-y-auto whitespace-pre-wrap leading-8 text-slate-700">{item.itemText ?? item.description ?? "No agenda text is available."}</p>
      </section>

      <aside className="space-y-8">
        <section aria-labelledby="flags-heading">
          <div className="flex items-center gap-3"><Flag className="text-blue-700" size={20} /><h2 id="flags-heading" className="text-xl font-bold">Linked flags</h2></div>
          <div className="mt-4 space-y-3">{item.conflicts.length === 0 ? <div className="surface p-5 text-sm text-slate-600">No conflict flags are linked to this item.</div> : item.conflicts.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group block p-5 transition hover:border-blue-300"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{titleCase(conflict.conflictType)}</span><SeverityBadge severity={conflict.severity} /></div><h3 className="mt-3 font-semibold group-hover:text-blue-800">{conflict.politician.fullName}</h3>{conflict.entityName && <p className="mt-2 text-sm text-slate-600">Matched entity: {conflict.entityName}</p>}</Link>)}</div>
        </section>

        <section aria-labelledby="rollcall-heading">
          <div className="flex items-center gap-3"><Vote className="text-blue-700" size={20} /><h2 id="rollcall-heading" className="text-xl font-bold">Roll call</h2></div>
          {(item.rollCall?.length ?? 0) === 0 ? <p className="surface mt-4 p-5 text-sm text-slate-600">No roll call was published for this item.</p>
            : <ul className="surface mt-4 divide-y divide-slate-100">{item.rollCall!.map((vote) => {
              const profile = profiles.get(vote.personName.split(" ").filter((_, index, all) => index === 0 || index === all.length - 1).join(" ").toLowerCase());
              return <li key={vote.personName} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">{profile ? <Link to={`/politicians/${encodeURIComponent(profile.slug ?? profile.id)}`} className="font-semibold text-blue-800">{vote.personName}</Link> : <span>{vote.personName}</span>}<span className="font-semibold">{vote.value}</span></li>;
            })}</ul>}
        </section>

        <section aria-labelledby="attachments-heading">
          <div className="flex items-center gap-3"><Paperclip className="text-blue-700" size={20} /><h2 id="attachments-heading" className="text-xl font-bold">Attachments</h2></div>
          {(item.attachments?.length ?? 0) === 0 ? <p className="surface mt-4 p-5 text-sm text-slate-600">No attachments were published for this item.</p>
            : <ul className="surface mt-4 divide-y divide-slate-100">{item.attachments!.map((attachment, index) => <li key={`${attachment.name}-${index}`} className="px-4 py-3 text-sm">{attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700">{attachment.name} <ExternalLink size={13} /></a> : attachment.name}</li>)}</ul>}
        </section>
      </aside>
    </div>
  </div>;
}
