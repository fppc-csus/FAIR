import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, FileClock, Search } from 'lucide-react';
import { AdminGuard, AdminNav } from '../adminComponents';
import { adminFetch } from '../adminAuth';
import RequestError from '../components/RequestError';
import { safeMessage } from '../lib/request';

type Result = { filer_name?: string; filing_year?: number; status?: string; slug?: string; jurisdiction?: string | null; error?: string; filing_type?: string; versions?: unknown[]; detection?: { skippedReason?: string; detectionErrors?: unknown[] }; schedules_parsed?: Record<string, number> };
type HistoryRow = { id: string; filename: string; createdAt: string; status: string; imported: number; skipped: number; failed: number; warnings: string[]; results: Result[] };
type Response = { data: HistoryRow[]; pagination: { page: number; pageCount: number; total: number } };

export function meta() { return [{ title: 'Form 700 warnings and history | FAIR Admin' }]; }

export default function AdminHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageCount: 1, total: 0 });
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [year, setYear] = useState(''); const [status, setStatus] = useState('');
  const [warningOnly, setWarningOnly] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('search', query); if (warningOnly) params.set('warningOnly', 'true');
    if (year) params.set('year', year); if (status) params.set('status', status);
    adminFetch(`/api/admin/history?${params}`).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.data) || !payload.pagination) throw new Error(payload.error ?? 'Could not load Form 700 import history.');
      if (active) { const result = payload as Response; setRows(result.data); setPagination(result.pagination); }
    }).catch(reason => { if (active) setError(safeMessage(reason, 'Could not load Form 700 import history.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, query, warningOnly, year, status, attempt]);

  function submitSearch(event: React.FormEvent) { event.preventDefault(); setPage(1); setQuery(search.trim()); }
  return <AdminGuard><div className="min-h-screen bg-slate-50 text-slate-900"><AdminNav title="Warnings and history" />
    <main className="mx-auto max-w-7xl space-y-6 px-5 py-8">
      <header><div className="flex items-center gap-3"><FileClock className="text-blue-700" /><div><h2 className="text-2xl font-bold">Form 700 import history</h2><p className="mt-1 text-sm text-slate-600">Review confirmed imports, amendment warnings, skipped filings, and per-filer outcomes.</p></div></div></header>
      <section className="surface flex flex-wrap items-end gap-4 p-4"><form onSubmit={submitSearch} className="flex min-w-64 flex-1 gap-2"><label className="sr-only" htmlFor="history-search">Search filename or filer</label><input id="history-search" className="field" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search filename or filer" /><button className="button-secondary" type="submit"><Search size={16} /> Search</button></form><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={warningOnly} onChange={event => { setWarningOnly(event.target.checked); setPage(1); }} /> Warnings or failures only</label></section>
      <section className="flex flex-wrap gap-4" aria-label="History filters">
        <label className="text-sm font-medium">Filing year<input className="field mt-1" type="number" min="1900" max="2099" placeholder="All years" value={year} onChange={event => { setYear(event.target.value); setPage(1); }} /></label>
        <label className="text-sm font-medium">Import status<select className="field mt-1" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="running">Running / interrupted</option><option value="completed">Completed</option><option value="partial">Partial</option><option value="failed">Failed</option></select></label>
      </section>
      {error && <RequestError message={error} onRetry={() => setAttempt(value => value + 1)} />}
      {loading && <div className="surface p-8 text-slate-600" role="status">Loading import history…</div>}
      {!loading && !error && <><p className="text-sm text-slate-600"><strong>{pagination.total}</strong> import record{pagination.total === 1 ? '' : 's'}</p>
        {rows.length === 0 ? <section className="surface p-10 text-center"><h3 className="font-semibold">No import history matches these filters</h3></section> : <div className="space-y-4">{rows.map(row => <article key={row.id} className="surface p-5">
          <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{row.filename}</h3><p className="mt-1 text-sm text-slate-500">{new Date(row.createdAt).toLocaleString()} · {row.status}</p></div><p className="text-sm"><strong>{row.imported}</strong> imported · <strong>{row.skipped}</strong> skipped · <strong className={row.failed ? 'text-red-700' : ''}>{row.failed}</strong> failed</p></div>
          {row.warnings.length > 0 && <div className="mt-4 border-l-4 border-amber-500 bg-amber-50 p-3"><h4 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle size={16} /> Recorded warnings</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">View {row.results.length} filer result{row.results.length === 1 ? '' : 's'}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Filer</th><th className="p-2">Year</th><th className="p-2">Jurisdiction</th><th className="p-2">Schedules</th><th className="p-2">Outcome</th></tr></thead><tbody>{row.results.map((result, index) => <tr className="border-t" key={index}><td className="p-2">{result.slug ? <a className="font-medium text-blue-800 underline" href={`/politicians/${encodeURIComponent(result.slug)}`}>{result.filer_name}</a> : result.filer_name ?? 'Unknown'}</td><td className="p-2">{result.filing_year ?? '—'}</td><td className="p-2">{result.jurisdiction ?? '—'}</td><td className="p-2">{result.schedules_parsed ? Object.entries(result.schedules_parsed).map(([key, value]) => `${key}: ${value}`).join(' · ') : '—'}</td><td className="p-2">{result.status ?? 'unknown'}{result.filing_type && <p>{result.filing_type} · {result.versions?.length ?? 1} version(s)</p>}{result.detection?.skippedReason && <p className="text-amber-900">Detection: {result.detection.skippedReason}</p>}{Boolean(result.detection?.detectionErrors?.length) && <p className="text-amber-900">Detection failures: {result.detection?.detectionErrors?.length}</p>}{result.error ? ` — ${result.error}` : ''}</td></tr>)}</tbody></table></div></details>
        </article>)}</div>}
        {pagination.pageCount > 1 && <nav className="flex justify-end gap-2" aria-label="Import history pagination"><button className="button-secondary" disabled={pagination.page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /> Previous</button><span className="px-3 py-2 text-sm">Page {pagination.page} of {pagination.pageCount}</span><button className="button-secondary" disabled={pagination.page >= pagination.pageCount} onClick={() => setPage(value => value + 1)}>Next <ChevronRight size={16} /></button></nav>}
      </>}
    </main></div></AdminGuard>;
}