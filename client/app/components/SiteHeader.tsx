import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Menu, Search, ShieldCheck, X } from "lucide-react";

type SearchResult = { type: string; id: string; title: string; preview: string; href: string };
type SearchGroups = { politicians: SearchResult[]; agendaItems: SearchResult[]; conflicts: SearchResult[] };
type SearchResponse = { groups: SearchGroups };

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const navItems = [
  { to: "/", label: "Overview", end: true },
  { to: "/conflicts", label: "Conflict flags", end: false },
  { to: "/politicians", label: "Public officials", end: false },
  { to: "/about", label: "About", end: false },
];

function ResultGroup({ title, results, onSelect }: { title: string; results: SearchResult[]; onSelect: () => void }) {
  if (!results.length) return null;
  return <section><h2 className="px-4 pb-2 pt-3 text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>{results.map((result) => <Link key={`${result.type}-${result.id}`} to={result.href} onClick={onSelect} className="block border-t border-slate-100 px-4 py-3 transition hover:bg-slate-50"><p className="text-sm font-semibold text-slate-950">{result.title}</p>{result.preview && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{result.preview}</p>}</Link>)}</section>;
}

export function SiteHeader() {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroups | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setMobileOpen(false); setQuery(""); setGroups(null); }, [location.pathname]);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { setGroups(null); setError(""); setIsLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true); setError("");
      try {
        const response = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search request failed");
        setGroups(((await response.json()) as SearchResponse).groups);
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) { setGroups(null); setError("Search is temporarily unavailable."); }
      } finally { setIsLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const total = groups ? groups.politicians.length + groups.agendaItems.length + groups.conflicts.length : 0;
  const showResults = Boolean(query.trim());

  return <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex h-16 items-center gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="FAIR home"><span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 text-white"><ShieldCheck size={20} aria-hidden="true" /></span><span className="hidden sm:block"><span className="block text-base font-bold leading-none text-slate-950">FAIR</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Public records review</span></span></Link>
        <nav aria-label="Primary navigation" className="hidden items-center gap-1 lg:flex">{navItems.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `rounded-md px-3 py-2 text-sm font-medium transition ${isActive ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>{item.label}</NavLink>)}</nav>
        <div className="relative ml-auto w-full max-w-md">
          <label htmlFor="global-search" className="sr-only">Search FAIR records</label><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} aria-hidden="true" />
          <input id="global-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" className="field h-10 pl-9 pr-9" aria-expanded={showResults} aria-controls="global-search-results" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100"><X size={16} /></button>}
          {showResults && <div id="global-search-results" className="absolute right-0 top-12 max-h-[70vh] w-[min(92vw,32rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl" aria-live="polite">{isLoading && <p className="px-4 py-5 text-sm text-slate-600">Searching public records…</p>}{error && <p role="alert" className="px-4 py-5 text-sm text-red-700">{error}</p>}{!isLoading && !error && groups && total === 0 && <p className="px-4 py-5 text-sm text-slate-600">No records found for “{query.trim()}”.</p>}{!isLoading && !error && groups && total > 0 && <div className="pb-2"><ResultGroup title="Public officials" results={groups.politicians} onSelect={() => setQuery("")} /><ResultGroup title="Agenda items" results={groups.agendaItems} onSelect={() => setQuery("")} /><ResultGroup title="Conflict flags" results={groups.conflicts} onSelect={() => setQuery("")} /></div>}</div>}
        </div>
        <button type="button" onClick={() => setMobileOpen((open) => !open)} className="rounded-lg border border-slate-200 p-2 text-slate-700 lg:hidden" aria-label="Toggle navigation" aria-expanded={mobileOpen}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
      {mobileOpen && <nav aria-label="Mobile navigation" className="grid gap-1 border-t border-slate-100 py-3 lg:hidden">{navItems.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `rounded-md px-3 py-2.5 text-sm font-medium ${isActive ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}>{item.label}</NavLink>)}</nav>}
    </div>
  </header>;
}