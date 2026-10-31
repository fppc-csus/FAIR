import { useState, type ChangeEvent } from 'react';
import { adminFetch } from '../adminAuth';
import { safeMessage } from '../lib/request';

type Filing = { filer_name: string; agency: string; filing_year: number; filing_type: string; filed_at: string; status: string; versions: unknown[]; schedules_parsed: Record<string, number> };
type Preview = { digest: string; filings: Filing[]; warnings: string[] };
type Result = { imported: number; skipped: number; failed: number; results: { filer_name: string; status: string; slug?: string; error?: string; detection?: { skippedReason?: string } }[] };

export default function Form700BulkUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const candidate = event.target.files?.[0];
    setPreview(null); setResult(null); setConfirmed(false); setError(null); setFile(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.xlsx') || candidate.size > 10 * 1024 * 1024) {
      setError('Choose an XLSX workbook no larger than 10 MB.'); return;
    }
    setFile(candidate);
  }

  async function submit(action: 'preview' | 'import') {
    if (!file || busy || (action === 'import' && (!preview || !confirmed))) return;
    setBusy(true); setError(null); setResult(null);
    if (action === 'preview') { setPreview(null); setConfirmed(false); }
    try {
      const body = new FormData(); body.append('file', file);
      if (action === 'import' && preview) body.append('digest', preview.digest);
      const response = await adminFetch(`/api/admin/upload/form700/bulk/${action}`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not process workbook.');
      if (action === 'preview') setPreview(payload);
      else { setResult(payload); setPreview(null); setConfirmed(false); }
    } catch (failure) { setError(safeMessage(failure, 'Could not process workbook. Refresh preview before retrying an uncertain import.')); }
    finally { setBusy(false); }
  }

  return <section className="surface p-5 sm:p-7" aria-labelledby="bulk-upload-title">
    <h2 id="bulk-upload-title" className="text-lg font-semibold">Bulk Form 700 import</h2>
    <p className="mt-2 text-sm text-slate-600">Upload a NetFile-style XLSX with filer, agency, filing year and filed date columns on each schedule. Each filer is imported separately. PDFs are not supported.</p>
    <label className="mt-4 block text-sm font-medium" htmlFor="bulk-form700">Bulk workbook (maximum 10 MB)</label>
    <input id="bulk-form700" className="mt-2 block" type="file" accept=".xlsx" disabled={busy} onChange={chooseFile} />
    <button className="button-primary mt-4" type="button" disabled={!file || busy} onClick={() => submit('preview')}>{busy ? 'Processing workbook…' : 'Preview bulk workbook'}</button>
    {error && <p className="mt-4 text-red-800" role="alert">{error}</p>}
    {preview && <div className="mt-5 space-y-4">
      <p>{preview.filings.length} filer/year groups found. Existing filings are skipped, never overwritten. New profiles are flagged for review.</p>
      <p className="text-sm font-medium">Only the latest submission for each filer/year becomes active. Older versions remain in the original archive. Missing amendment schedules are not carried forward.</p>
      {preview.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Filer / agency', 'Year / submission', 'Schedule records', 'Status'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{preview.filings.map((filing, index) => <tr className="border-t" key={index}>
          <td className="p-2">{filing.filer_name}<br />{filing.agency}</td>
          <td className="p-2">{filing.filing_year} · {filing.filing_type}<br />{filing.filed_at.slice(0, 10)} · {filing.versions.length} version(s)</td>
          <td className="p-2">{Object.entries(filing.schedules_parsed).map(([schedule, count]) => `${schedule}: ${count}`).join(' · ')}</td>
          <td className="p-2">{filing.status === 'skipped' ? 'Existing filing — skip' : 'Ready'}</td>
        </tr>)}</tbody></table></div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the selected submissions and completeness warnings.</span></label>
      <button className="button-primary" type="button" disabled={busy || !confirmed || !preview.filings.some(f => f.status === 'ready')} onClick={() => submit('import')}>Confirm bulk import</button>
    </div>}
    {result && <div className="mt-5" aria-live="polite"><h3 className="font-semibold">Import results</h3>
      <p>{result.imported} imported · {result.skipped} skipped · {result.failed} failed</p>
      <ul className="mt-3 space-y-2">{result.results.map((item, index) => <li key={index}>{item.filer_name}: {item.status}{item.error && ` — ${item.error}`}{item.slug && <> · <a className="underline" href={`/politicians/${encodeURIComponent(item.slug)}`}>View profile</a></>}{item.detection?.skippedReason && ` · Detection: ${item.detection.skippedReason}`}</li>)}</ul>
      {result.failed > 0 && <p className="mt-3">Resolve reported failures, then preview again. Successful imports will be skipped on retry.</p>}
    </div>}
  </section>;
}