import { useRef, useState, type ChangeEvent } from 'react';
import { Files, Upload } from 'lucide-react';
import { adminFetch } from '../adminAuth';
import { safeMessage } from '../lib/request';

type Filing = { filer_name: string; agency: string; filing_year: number; filing_type: string; filed_at: string; status: string; versions: unknown[]; schedules_parsed: Record<string, number> };
type Preview = { digest: string; filings: Filing[]; warnings: string[] };
type Result = { imported: number; replaced?: number; skipped: number; failed: number; results: { filer_name: string; status: string; slug?: string; error?: string; detection?: { skippedReason?: string } }[] };

export default function Form700BulkUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const existingCount = preview?.filings.filter(filing => filing.status === 'skipped').length ?? 0;
  const readyCount = (preview?.filings.filter(filing => filing.status === 'ready').length ?? 0) + (replaceExisting ? existingCount : 0);

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
      if (action === 'import' && replaceExisting) body.append('replace_existing', 'true');
      const response = await adminFetch(`/api/admin/upload/form700/bulk/${action}`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not process workbook.');
      if (action === 'preview') setPreview(payload);
      else { setResult(payload); setPreview(null); setConfirmed(false); }
    } catch (failure) { setError(safeMessage(failure, 'Could not process workbook. Refresh preview before retrying an uncertain import.')); }
    finally { setBusy(false); }
  }

  return <section className="surface min-w-0 border-t-4 border-t-blue-700 p-5 sm:p-7" aria-labelledby="bulk-upload-title">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-blue-100 p-2 text-blue-800"><Files size={24} aria-hidden="true" /></div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-blue-800">Multiple officials · XLSX only</p>
        <h2 id="bulk-upload-title" className="mt-1 text-xl font-semibold">Bulk Form 700 import</h2>
      </div>
    </div>
    <p className="mt-4 text-sm text-slate-700">Use this for a county or agency NetFile export containing disclosures for multiple officials. Each filer is imported separately.</p>
    <div id="bulk-file-help" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      <p className="font-semibold">What goes here?</p>
      <p className="mt-1">One .xlsx workbook with filer, agency, filing year and filed date columns on each schedule. Maximum 10 MB.</p>
      <p className="mt-2 font-medium">Have a PDF or a single official’s cover-page workbook? Use the individual upload panel instead.</p>
    </div>
    <div className="mt-5 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50 p-5 text-center">
      <Upload className="mx-auto mb-3 text-blue-700" size={32} aria-hidden="true" />
      <p className="font-semibold text-slate-900">Select a multi-official workbook</p>
      <button className="button-primary mt-4 min-h-12 w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700" type="button" disabled={busy} aria-describedby="bulk-file-help" onClick={() => inputRef.current?.click()}>
        <Upload size={18} aria-hidden="true" />{file ? 'Change bulk XLSX workbook' : 'Choose bulk XLSX workbook'}
      </button>
      <label className="sr-only" htmlFor="bulk-form700">Bulk workbook (maximum 10 MB)</label>
      <input ref={inputRef} id="bulk-form700" className="sr-only" type="file" accept=".xlsx" disabled={busy} onChange={chooseFile} />
      <p className="mt-3 break-all text-sm text-slate-600" aria-live="polite">{file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'No workbook selected · XLSX only, no PDFs'}</p>
    </div>
    <p className="mt-4 text-sm text-slate-600">Choose workbook → Preview filings and warnings → Confirm import</p>
    <button className="button-primary mt-3 min-h-12 w-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700" type="button" disabled={!file || busy} onClick={() => submit('preview')}>{busy ? 'Processing workbook…' : 'Preview bulk workbook'}</button>
    {error && <p className="mt-4 text-red-800" role="alert">{error}</p>}
    {preview && <div className="mt-5 space-y-4">
      <p>{preview.filings.length} filer/year groups found. New profiles are flagged for identity review.</p>
      <p className="text-sm font-medium">Amendments are applied per schedule: each schedule comes from the newest submission that contains it, so schedules an amendment did not re-file are carried forward. Every column of every row is kept.</p>
      {existingCount > 0 && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={replaceExisting} disabled={busy} onChange={event => { setReplaceExisting(event.target.checked); setConfirmed(false); }} /><span><strong>Replace {existingCount} existing filing(s)</strong> with this workbook (corrected export or re-parse). Filing IDs and conflict review history are kept; conflicts are re-checked.</span></label>}
      {preview.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Filer / agency', 'Year / submission', 'Schedule records', 'Status'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{preview.filings.map((filing, index) => <tr className="border-t" key={index}>
          <td className="p-2">{filing.filer_name}<br />{filing.agency}</td>
          <td className="p-2">{filing.filing_year} · {filing.filing_type}<br />{filing.filed_at.slice(0, 10)} · {filing.versions.length} version(s)</td>
          <td className="p-2">{Object.entries(filing.schedules_parsed).map(([schedule, count]) => `${schedule}: ${count}`).join(' · ')}</td>
          <td className="p-2">{filing.status === 'skipped' ? (replaceExisting ? 'Existing filing — replace' : 'Existing filing — skip') : 'Ready'}</td>
        </tr>)}</tbody></table></div>
      <p role="status">{readyCount > 0 ? `${readyCount} filing(s) ready to import. Warnings do not block import after acknowledgement.` : 'Nothing to import: all filings already exist. Tick “Replace existing filings” to re-import them.'}</p>
      {readyCount > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the selected submissions and completeness warnings.</span></label>}
      {readyCount > 0 && !confirmed && <p id="bulk-confirm-help" className="text-sm text-slate-600">Check the review acknowledgement above to enable Confirm bulk import.</p>}
      <button className="button-primary" type="button" aria-describedby={readyCount > 0 && !confirmed ? 'bulk-confirm-help' : undefined} disabled={busy || !confirmed || readyCount === 0} onClick={() => submit('import')}>Confirm bulk import</button>
    </div>}
    {result && <div className="mt-5" aria-live="polite"><h3 className="font-semibold">Import results</h3>
      <p>{result.imported} imported · {result.replaced ?? 0} replaced · {result.skipped} skipped · {result.failed} failed</p>
      <ul className="mt-3 space-y-2">{result.results.map((item, index) => <li key={index}>{item.filer_name}: {item.status}{item.error && ` — ${item.error}`}{item.slug && <> · <a className="underline" href={`/politicians/${encodeURIComponent(item.slug)}`}>View profile</a></>}{item.detection?.skippedReason && ` · Detection: ${item.detection.skippedReason}`}</li>)}</ul>
      {result.failed > 0 && <p className="mt-3">Resolve reported failures, then preview again. Successful imports will be skipped on retry.</p>}
    </div>}
  </section>;
}