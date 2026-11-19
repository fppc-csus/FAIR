import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { Link, useParams } from "react-router";
import { ArrowLeft, CalendarDays, Flag, Landmark, MapPin } from "lucide-react";

type Conflict = { id: string; conflictType: string; severity: string; entityName: string | null; ruleReference: string; politician: { id: string; fullName: string; district: string | null } };
type AgendaItem = { id: string; title: string | null; description: string | null; itemText: string | null; itemNumber: string | null; meetingDate: string | null; cityName: string | null; sourceType: string; bodyName: string | null; conflicts: Conflict[] };
const title = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());

export function meta() { return [{ title: "Agenda item | FAIR Investigations" }]; }
export default function AgendaDetail() {
  const { id } = useParams();
  const { data, loading, error, retry } = useApiData<AgendaItem>(`/api/agenda/${encodeURIComponent(id ?? "")}`);
  const item = data;
  if (loading) return <main className="page-shell"><div className="surface p-8 text-slate-600" role="status">Loading agenda item…</div></main>;
  if (error || !item) return <main className="page-shell"><RequestError message={error || "Record not found."} onRetry={retry} /></main>;
  return <main className="page-shell"><Link to="/conflicts" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16} /> Conflicts</Link><header className="mt-7 max-w-4xl"><p className="eyebrow">Agenda item {item.itemNumber ? `· ${item.itemNumber}` : ""}</p><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{item.title ?? "Untitled agenda item"}</h1><div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm text-slate-600">{item.meetingDate && <span className="inline-flex items-center gap-2"><CalendarDays size={16} />{new Date(item.meetingDate).toLocaleDateString()}</span>}{item.cityName && <span className="inline-flex items-center gap-2"><MapPin size={16} />{item.cityName}</span>}{item.bodyName && <span className="inline-flex items-center gap-2"><Landmark size={16} />{item.bodyName}</span>}</div></header>
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_0.6fr]"><section className="surface p-6 sm:p-8"><h2 className="text-xl font-bold">Agenda text</h2><p className="mt-5 whitespace-pre-wrap leading-8 text-slate-700">{item.itemText ?? item.description ?? "No agenda text is available."}</p></section><aside><div className="flex items-center gap-3"><Flag className="text-blue-700" size={20} /><h2 className="text-xl font-bold">Linked flags</h2></div><p className="mt-2 text-sm leading-6 text-slate-600">Potential overlaps associated with this item.</p><div className="mt-4 space-y-3">{item.conflicts.length === 0 ? <div className="surface p-5 text-sm text-slate-600">No conflict flags are linked to this item.</div> : item.conflicts.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group block p-5 transition hover:border-blue-300"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{title(conflict.conflictType)}</span><span className="text-xs font-bold text-slate-700">{conflict.severity}</span></div><h3 className="mt-3 font-semibold group-hover:text-blue-800">{conflict.politician.fullName}</h3>{conflict.entityName && <p className="mt-2 text-sm text-slate-600">Matched entity: {conflict.entityName}</p>}</Link>)}</div></aside></div>
  </main>;
}