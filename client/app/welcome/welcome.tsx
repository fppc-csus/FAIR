import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Building2, FileSearch, Scale, ShieldCheck } from "lucide-react";
import { apiBaseUrl } from "../lib/supabase";

type Conflict = { id: string; politicianName: string; city: string; conflictType: string; severity: string; agendaItemSummary: string; detectedAt: string };
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
const severityClass = (severity: string) => severity.toUpperCase() === "HIGH" ? "bg-red-50 text-red-800 ring-red-200" : severity.toUpperCase() === "MEDIUM" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-blue-50 text-blue-800 ring-blue-200";

export function Welcome() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/conflicts`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Unable to load conflict flags"); return response.json(); })
      .then((payload) => setConflicts(Array.isArray(payload.data) ? payload.data.slice(0, 6) : []))
      .catch((reason) => { if (reason.name !== "AbortError") setError("Recent flags are temporarily unavailable."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return <main>
    <section className="border-b border-slate-200 bg-white"><div className="page-shell grid items-center gap-12 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
      <div><p className="eyebrow">California public records</p><h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">Understand where public decisions and financial interests overlap.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">FAIR brings local government agendas and Form 700 disclosures into one searchable place, helping the public review potential conflicts with context.</p><div className="mt-8 flex flex-wrap gap-3"><Link to="/conflicts" className="button-primary">Browse conflict flags <ArrowRight size={17} /></Link><Link to="/politicians" className="button-secondary">Find a public official</Link></div></div>
      <aside className="surface overflow-hidden" aria-label="How FAIR works"><div className="border-b border-slate-200 bg-slate-950 p-6 text-white"><ShieldCheck size={28} /><h2 className="mt-4 text-xl font-semibold">Review with context</h2><p className="mt-2 text-sm leading-6 text-slate-300">Automated flags are starting points for review. They are not findings of wrongdoing.</p></div><ol className="divide-y divide-slate-200 p-2">{[[FileSearch, "Collect public records", "City agendas and financial disclosures are organized together."], [Scale, "Compare reported interests", "FAIR identifies possible overlaps using documented rules."], [Building2, "Open the source context", "Review the official, agenda item, disclosure, and rule behind each flag."]].map(([Icon, title, copy], index) => <li key={String(title)} className="flex gap-4 p-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-bold text-blue-800">{index + 1}</span><div><h3 className="font-semibold text-slate-950">{String(title)}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{String(copy)}</p></div></li>)}</ol></aside>
    </div></section>
    <section className="page-shell"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Latest records</p><h2 className="mt-2 text-3xl font-bold tracking-tight">Recent conflict flags</h2><p className="mt-2 max-w-2xl text-slate-600">Potential overlaps detected in available public records, ordered by detection date.</p></div><Link to="/conflicts" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">View all flags <ArrowRight size={16} /></Link></div>
      {error && <div role="alert" className="surface mt-8 border-red-200 bg-red-50 p-5 text-red-800">{error}</div>}{loading && <div className="surface mt-8 p-8 text-slate-600" role="status">Loading recent public records…</div>}{!loading && !error && conflicts.length === 0 && <div className="surface mt-8 p-10 text-center"><h3 className="font-semibold">No conflict flags are available</h3><p className="mt-2 text-sm text-slate-600">New records will appear here after they have been processed.</p></div>}
      {!loading && !error && conflicts.length > 0 && <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{conflicts.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group flex min-h-64 flex-col p-5 transition hover:-translate-y-0.5 hover:border-blue-300"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{conflict.city}</p><h3 className="mt-2 text-lg font-semibold group-hover:text-blue-800">{conflict.politicianName}</h3></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${severityClass(conflict.severity)}`}>{conflict.severity}</span></div><p className="mt-5 text-sm font-semibold text-slate-800">{label(conflict.conflictType)}</p><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{conflict.agendaItemSummary}</p><span className="mt-auto pt-5 text-sm font-semibold text-blue-700">Review flag →</span></Link>)}</div>}
    </section>
  </main>;
}