import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { IdentityBadge } from "../components/investigator";

type Politician = { id: string; slug?: string; fullName: string; officeTitle?: string | null; district: string | null; jurisdiction?: string | null; identityVerified?: boolean | null; filingYears?: number[]; disclosureCount?: number; conflictCount: number };
export function meta() { return [{ title: "Officials | FAIR Investigations" }]; }

export default function Politicians() {
  const { data, loading, error, retry } = useApiData<Politician[]>(`/api/politicians?limit=500`);
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const politicians = useMemo(() => data ?? [], [data]);
  const jurisdictions = useMemo(() => [...new Set(politicians.map((p) => p.jurisdiction).filter(Boolean) as string[])].sort(), [politicians]);
  const visible = useMemo(() => politicians.filter((p) =>
    `${p.fullName} ${p.officeTitle ?? ""} ${p.district ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
    && (!jurisdiction || p.jurisdiction === jurisdiction)
    && (!onlyFlagged || p.conflictCount > 0)), [politicians, query, jurisdiction, onlyFlagged]);

  return <main className="page-shell">
    <header className="max-w-3xl"><p className="eyebrow">Filers</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Officials</h1><p className="mt-4 text-lg leading-8 text-slate-600">Every Form 700 filer FAIR holds. Open an official for their complete disclosures, flags and review history.</p></header>
    <div className="surface mt-8 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <label className="flex items-center gap-3"><Search className="text-slate-400" size={19} aria-hidden="true" /><span className="sr-only">Search officials</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-sm outline-none" placeholder="Search by name, office or district" /></label>
      <label className="text-sm"><span className="sr-only">Jurisdiction</span><select className="field" value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)}><option value="">All jurisdictions</option>{jurisdictions.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={onlyFlagged} onChange={(event) => setOnlyFlagged(event.target.checked)} />With flags only</label>
    </div>
    {error && <RequestError message={error} onRetry={retry} />}{loading && <div className="surface mt-8 p-8 text-slate-600" role="status">Loading officials…</div>}
    {!loading && !error && <section className="mt-6" aria-label="Officials directory"><p className="mb-3 text-sm text-slate-600">{visible.length} official{visible.length === 1 ? "" : "s"}</p>
      {visible.length === 0 ? <div className="surface p-10 text-center"><h2 className="font-semibold">No officials match</h2><p className="mt-2 text-sm text-slate-600">Clear a filter or shorten the search.</p></div>
        : <div className="surface overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Official</th><th className="px-4 py-3">Jurisdiction</th><th className="px-4 py-3">Form 700 years</th><th className="px-4 py-3 text-right">Disclosures</th><th className="px-4 py-3 text-right">Flags</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map((p) => <tr key={p.id} className="hover:bg-slate-50"><td className="px-4 py-3"><Link to={`/politicians/${encodeURIComponent(p.slug ?? p.id)}`} className="font-semibold text-slate-950 hover:text-blue-800">{p.fullName}</Link><p className="text-xs text-slate-500">{p.officeTitle ?? "Office not listed"}{p.district ? ` · District ${p.district}` : ""}</p><div className="mt-1"><IdentityBadge verified={p.identityVerified} /></div></td><td className="px-4 py-3 text-slate-700">{p.jurisdiction ?? "—"}</td><td className="px-4 py-3 tabular-nums text-slate-700">{p.filingYears?.length ? p.filingYears.join(", ") : "None"}</td><td className="px-4 py-3 text-right tabular-nums">{p.disclosureCount ?? "—"}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.conflictCount ? "text-red-700" : "text-slate-500"}`}>{p.conflictCount}</td></tr>)}</tbody></table></div>}
    </section>}
  </main>;
}
