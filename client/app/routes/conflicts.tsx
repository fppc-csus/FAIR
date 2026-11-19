import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { useEffect, useState } from "react";
import { downloadAuthenticated, investigatorFetch } from "../adminAuth";
import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Download, Filter, RotateCcw } from "lucide-react";
import { IdentityBadge, ReviewBadge, SeverityBadge, formatDate, titleCase as title } from "../components/investigator";
import { safeMessage } from "../lib/request";

const PAGE_SIZE = 20;

type Conflict = { id: string; politicianName: string; city: string; conflictType: string; severity: string; agendaItemSummary: string; detectedAt: string; reviewStatus?: string; entityName?: string | null; meetingDate?: string | null; identityVerified?: boolean | null };

export function meta() { return [{ title: "Conflicts | FAIR Investigations" }]; }

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
  const url = `/api/conflicts?${query}`;
  const [result, setResult] = useState<{ data: Conflict[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt(value => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setResult(null);
    void investigatorFetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 400 ? 'Invalid filters or page. Clear filters and try again.' : 'These records are temporarily unavailable. Please try again.');
      const payload = await response.json();
      if (!Array.isArray(payload.data) || !Number.isInteger(payload.total)) throw new Error('The server returned an incomplete response.');
      if (!controller.signal.aborted) setResult(payload);
    }).catch(reason => { if (!controller.signal.aborted && reason?.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt]);
  const { data: cityOptions, error: cityError, retry: retryCities } = useApiData<string[]>(`/api/conflicts/filters`);
  const [exportError, setExportError] = useState<string | null>(null);
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
  const exportUrl = `/api/conflicts/export?${exportParams.toString()}`;
  async function exportCsv() {
    setExportError(null);
    try { await downloadAuthenticated(exportUrl, "fair-conflicts.csv"); }
    catch (reason) { setExportError(safeMessage(reason, "The export could not be generated. Please retry.")); }
  }

  return <div className="page-shell"><header className="max-w-3xl"><p className="eyebrow">Case review</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Conflicts</h1><p className="mt-4 text-lg leading-8 text-slate-600">Candidate overlaps between reported financial interests and agenda items. Open a flag to see the matching agenda passage, the full Form 700 entry and the review history.</p></header>
    <section className="surface mt-8 p-5" aria-labelledby="filter-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Filter size={18} className="text-blue-700" /><h2 id="filter-heading" className="font-semibold">Filter records</h2></div>{hasFilters && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"><RotateCcw size={15} /> Clear filters</button>}</div><div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-semibold text-slate-700">City<select value={city} onChange={(event) => updateFilter("city", event.target.value)} className="field mt-2"><option value="">All cities</option>{cities.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Flag type<select value={type} onChange={(event) => updateFilter("types", event.target.value)} className="field mt-2"><option value="">All flag types</option>{types.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Severity<select value={severity} onChange={(event) => updateFilter("severities", event.target.value)} className="field mt-2"><option value="">All severities</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label><label className="text-sm font-semibold text-slate-700">Sort by<select value={sort} onChange={(event) => updateFilter("sort", event.target.value)} className="field mt-2"><option value="detectedAt">Most recently detected</option><option value="oldest">Oldest first</option><option value="severity">Highest severity</option></select></label>
      <label className="text-sm font-semibold">Detected from<input type="date" className="field mt-2" value={fromDate} onChange={event => updateFilter('fromDate', event.target.value)} /></label>
      <label className="text-sm font-semibold">Detected through<input type="date" className="field mt-2" value={toDate} onChange={event => updateFilter('toDate', event.target.value)} /></label>
      <label className="text-sm font-semibold">Review state<select className="field mt-2" value={reviewStatus} onChange={event => updateFilter('reviewStatus', event.target.value)}><option value="">All review states</option><option value="pending">Pending</option><option value="confirmed_conflict">Confirmed conflict</option><option value="not_applicable">Not applicable</option></select></label>
    </div></section>
    {cityError && <RequestError message={cityError} onRetry={retryCities} />}{exportError && <RequestError message={exportError} onRetry={exportCsv} />}{error && <RequestError message={error} onRetry={retry} />}{loading && <div className="surface mt-6 p-8 text-slate-600" role="status">Loading conflict flags…</div>}
    {!loading && !error && <section className="mt-6" aria-label="Conflict flag results"><div className="mb-4 flex items-center justify-between gap-4"><p className="text-sm text-slate-600"><strong className="text-slate-950">{total}</strong> record{total === 1 ? "" : "s"}</p><p className="text-sm text-slate-500">Page {page} of {pageCount}</p>
<button type="button" onClick={exportCsv} className="button-primary"><Download size={16} /> Download CSV</button></div>{visible.length === 0 ? <div className="surface p-12 text-center"><h2 className="text-lg font-semibold">No records match these filters</h2><p className="mt-2 text-sm text-slate-600">Clear a filter to broaden the results.</p></div> : <div className="space-y-3">{visible.map((conflict) => <Link key={conflict.id} to={`/conflicts/${conflict.id}`} className="surface group grid gap-4 p-5 transition hover:border-blue-300 md:grid-cols-[1fr_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={conflict.severity} /><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title(conflict.conflictType)}</span><ReviewBadge status={conflict.reviewStatus} /><IdentityBadge verified={conflict.identityVerified} /></div><h2 className="mt-3 text-lg font-semibold group-hover:text-blue-800">{conflict.politicianName}</h2><p className="mt-1 text-sm text-slate-500">{conflict.city} · Meeting {formatDate(conflict.meetingDate)} · Detected {formatDate(conflict.detectedAt)}</p>{conflict.entityName && <p className="mt-2 text-sm"><span className="text-slate-500">Matched entity:</span> <strong className="text-slate-900">{conflict.entityName}</strong></p>}<p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{conflict.agendaItemSummary}</p></div><span className="text-sm font-semibold text-blue-700">Investigate →</span></Link>)}</div>}
      {pageCount > 1 && <nav aria-label="Results pagination" className="mt-6 flex items-center justify-end gap-2"><button className="button-secondary px-3" disabled={page === 1} onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft size={17} /> Previous</button><button className="button-secondary px-3" disabled={page >= pageCount} onClick={() => setPage(Math.min(pageCount, page + 1))}>Next <ChevronRight size={17} /></button></nav>}</section>}
  </div>;
}
