import { usePublicData } from "../hooks/usePublicData";
import RequestError from "../components/RequestError";
import { useEffect, useState } from "react";
import { request } from "../lib/request";
import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Filter, RotateCcw } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const PAGE_SIZE = 20;

type Conflict = { id: string; politicianName: string; city: string; conflictType: string; severity: string; agendaItemSummary: string; detectedAt: string };

const title = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
const severityClass = (severity: string) => severity.toUpperCase() === "HIGH" ? "bg-red-50 text-red-800 ring-red-200" : severity.toUpperCase() === "MEDIUM" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-blue-50 text-blue-800 ring-blue-200";

export function meta() { return [{ title: "Conflict flags | FAIR" }, { name: "description", content: "Browse potential conflicts identified from public Form 700 disclosures and local government agendas." }]; }

export default function ConflictsDashboard() {
  const [params, setParams] = useSearchParams();
  const city = params.get('city') ?? '';
  const type = params.get('types') ?? '';
  const severity = params.get('severities') ?? '';
  const sort = params.get('sort') ?? 'detectedAt';
  const page = Number(params.get('page') ?? 1);
  const fromDate = params.get('fromDate') ?? '';
  const toDate = params.get('toDate') ?? '';
  const reviewStatus = params.get('reviewStatus') ?? '';
  const query = new URLSearchParams(params);
  query.set('pageSize', String(PAGE_SIZE));
  const url = `${API_URL}/api/conflicts?${query}`;
  const [result, setResult] = useState<{ data: Conflict[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt(value => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setResult(null);
    void request(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 400 ? 'Invalid filters or page. Clear filters and try again.' : 'These records are temporarily unavailable. Please try again.');
      const payload = await response.json();
      if (!Array.isArray(payload.data) || !Number.isInteger(payload.total)) throw new Error('The server returned an incomplete response.');
      if (!controller.signal.aborted) setResult(payload);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt]);
  const { data: cityOptions, error: cityError, retry: retryCities } = usePublicData<string[]>(`${API_URL}/api/conflicts/filters`);
  const cities = [...new Set([...(cityOptions ?? []), ...(city ? [city] : [])])].sort();
  const types = ['INVESTMENT', 'REAL_ESTATE', 'BUSINESS_POSITION', 'INCOME', 'GIFT', 'TRAVEL'];
  const visible = result?.data ?? [];
  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(city || type || severity || fromDate || toDate || reviewStatus || error);
  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page'); setParams(next);
  }
  function setPage(value: number) {
    const next = new URLSearchParams(params); next.set('page', String(value)); setParams(next);
  }
  function clearFilters() { setParams({}); }

  const exportParams = new URLSearchParams();
  if (city) exportParams.set("city", city);
  if (type) exportParams.append("types", type);
  if (severity) exportParams.append("severities", severity);
  if (fromDate) exportParams.set('fromDate', fromDate);
  if (toDate) exportParams.set('toDate', toDate);
  if (reviewStatus) exportParams.set('reviewStatus', reviewStatus);
  const exportUrl = `${API_URL}/api/conflicts/export?${exportParams.toString()}`;

  return <main className="page-shell"><header className="max-w-3xl"><p className="eyebrow">Public review</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Conflict flags</h1><p className="mt-4 text-lg leading-8 text-slate-600">Explore potential overlaps between reported financial interests and local government agenda items. A flag supports review; it does not establish a legal conflict.</p></header>
    <section className="surface mt-8 p-5" aria-labelledby="filter-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Filter size={18} className="text-blue-700" /><h2 id="filter-heading" className="font-semibold">Filter records</h2></div>{hasFilters && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"><RotateCcw size={15} /> Clear filters</button>}</div><div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-semibold text-slate-700">City<select value={city} onChange={(event) => updateFilter("city", event.target.value)} className="field mt-2"><option value="">All cities</option>{cities.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Flag type<select value={type} onChange={(event) => updateFilter("types", event.target.value)} className="field mt-2"><option value="">All flag types</option>{types.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Severity<select value={severity} onChange={(event) => updateFilter("severities", event.target.value)} className="field mt-2"><option value="">All severities</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label><label className="text-sm font-semibold text-slate-700">Sort by<select value={sort} onChange={(event) => updateFilter("sort", event.target.value)} className="field mt-2"><option value="detectedAt">Most recent</option><option value="severity">Highest severity</option></select></label>
      <label className="text-sm font-semibold">Detected from<input type="date" className="field mt-2" value={fromDate} onChange={event => updateFilter('fromDate', event.target.value)} /></label>
      <label className="text-sm font-semibold">Detected through<input type="date" className="field mt-2" value={toDate} onChange={event => updateFilter('toDate', event.target.value)} /></label>
      <label className="text-sm font-semibold">Review state<select className="field mt-2" value={reviewStatus} onChange={event => updateFilter('reviewStatus', event.target.value)}><option value="">All review states</option><option value="pending">Pending</option><option value="confirmed_conflict">Confirmed conflict</option><option value="not_applicable">Not applicable</option></select></label>
    </div></section>
    {cityError && <RequestError message={cityError} onRetry={retryCities} />}{error && <RequestError message={error} onRetry={retry} />}{loading && <div className="surface mt-6 p-8 text-slate-600" role="status">Loading conflict flags…</div>}
    {!loading && !error && <section className="mt-6" aria-label="Conflict flag results"><div className="mb-4 flex items-center justify-between gap-4"><p className="text-sm text-slate-600"><strong className="text-slate-950">{total}</strong> record{total === 1 ? "" : "s"}</p><p className="text-sm text-slate-500">Page {page} of {pageCount}</p>
<a href={exportUrl} className="button-primary">Download CSV</a></div>{visible.length === 0 ? <div className="surface p-12 text-center"><h2 className="text-lg font-semibold">No records match these filters</h2><p className="mt-2 text-sm text-slate-600">Clear a filter to broaden the results.</p></div> : <div className="space-y-3">{visible.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group grid gap-4 p-5 transition hover:border-blue-300 md:grid-cols-[1fr_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${severityClass(conflict.severity)}`}>{conflict.severity}</span><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title(conflict.conflictType)}</span></div><h2 className="mt-3 text-lg font-semibold group-hover:text-blue-800">{conflict.politicianName}</h2><p className="mt-1 text-sm text-slate-500">{conflict.city} · Detected {new Date(conflict.detectedAt).toLocaleDateString()}</p><p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{conflict.agendaItemSummary}</p></div><span className="text-sm font-semibold text-blue-700">Review details →</span></Link>)}</div>}
      {pageCount > 1 && <nav aria-label="Results pagination" className="mt-6 flex items-center justify-end gap-2"><button className="button-secondary px-3" disabled={page === 1} onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft size={17} /> Previous</button><button className="button-secondary px-3" disabled={page >= pageCount} onClick={() => setPage(Math.min(pageCount, page + 1))}>Next <ChevronRight size={17} /></button></nav>}</section>}
  </main>;
}
