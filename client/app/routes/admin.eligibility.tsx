import { useEffect, useState } from 'react';
import { AdminGuard, AdminNav } from '../adminComponents';
import { adminFetch } from '../adminAuth';
import RequestError from '../components/RequestError';

type Jurisdiction = { id: string; name: string; type: string };
type Politician = { id: string; fullName: string; slug: string; jurisdictionId: string | null; jurisdiction?: { name: string } | null; reason: string };
type Filing = { id: string; filerName?: string | null; originalFilename?: string | null; filingYear: number | null; reason: string };
type Agenda = { id: string; title?: string | null; sourceType: string; sourceUrl?: string | null; meeting?: { agendaUrl?: string | null }; effectiveMeetingDate: string | null; reason: string };
type Queue = { jurisdictions: Jurisdiction[]; politicians: Politician[]; filings: Filing[]; agendaItems: Agenda[] };
type Entry = { kind: 'politician' | 'filing' | 'agenda'; id: string; title: string; value: string | number | null; reason: string; source?: string | null; href?: string | null };

export function meta() { return [{ title: 'Eligibility review | FAIR Admin' }]; }

export default function AdminEligibilityPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  async function load() {
    const response = await adminFetch('/api/admin/politicians/eligibility-review');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Could not load eligibility review.');
    setQueue(payload.data);
  }
  useEffect(() => { let active = true; setQueue(null); setError(null);
    adminFetch('/api/admin/politicians/eligibility-review').then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load eligibility review.');
      if (active) setQueue(payload.data);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load eligibility review.'); });
    return () => { active = false; };
  }, [attempt]);

  async function submit(entry: Entry, action: 'correct' | 'verify') {
    setBusy(entry.id); setError(null); setNotice(null);
    try {
      const expectedValue = entry.value;
      const correctedValue = entry.kind === 'filing' ? Number(corrections[entry.id]) : entry.kind === 'agenda'
        ? corrections[entry.id] ? new Date(`${corrections[entry.id]}T00:00:00.000Z`).toISOString() : null : corrections[entry.id];
      const response = await adminFetch(`/api/admin/eligibility/${entry.kind}/${encodeURIComponent(entry.id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'correct' ? { expectedValue, correctedValue } : { expectedValue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'STALE_VALUE' ? 'The value changed since you loaded it. Refresh the queue before trying again.' : payload.error ?? 'Action failed.');
      await load();
      setCorrections(previous => ({ ...previous, [entry.id]: '' }));
      setNotice(action === 'correct' ? 'Correction saved. Review the updated value, then confirm it separately.' : 'Reviewed value confirmed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action failed.'); }
    finally { setBusy(null); }
  }

  const entries: Entry[] = queue ? [
    ...queue.politicians.map(row => ({ kind: 'politician' as const, id: row.id, title: row.fullName, value: row.jurisdictionId, reason: row.reason, source: row.jurisdiction?.name, href: `/politicians/${encodeURIComponent(row.slug)}` })),
    ...queue.filings.map(row => ({ kind: 'filing' as const, id: row.id, title: row.filerName ?? row.id, value: row.filingYear, reason: row.reason, source: row.originalFilename })),
    ...queue.agendaItems.map(row => ({ kind: 'agenda' as const, id: row.id, title: row.title ?? row.id, value: row.effectiveMeetingDate, reason: row.reason, source: row.sourceType, href: row.sourceUrl ?? row.meeting?.agendaUrl })),
  ] : [];

  return <AdminGuard><div className="min-h-screen bg-slate-50 text-slate-900"><AdminNav title="Eligibility review" />
    <main className="mx-auto max-w-5xl space-y-5 px-5 py-8"><h2 className="text-2xl font-bold">Excluded metadata review</h2>
      <p>Inspect the source and current value. Corrections remain unverified until you confirm the updated value. A confirmation does not approve politician identity review.</p>
      {error && <RequestError message={error} onRetry={() => setAttempt(value => value + 1)} />}
      {notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
      {!queue && !error && <p role="status">Loading eligibility queue…</p>}
      {queue && !entries.length && <p role="status">No excluded records need metadata review.</p>}
      {entries.map(entry => <section key={entry.id} className="surface space-y-3 p-5" aria-label={`${entry.kind} ${entry.title}`}>
        <h3 className="font-semibold">{entry.title} <span className="text-sm font-normal">({entry.kind})</span></h3>
        <p className="text-sm">Reason: {entry.reason.replaceAll('_', ' ')}</p>
        <p className="text-sm">Current value: <strong>{entry.kind === 'politician' ? queue?.jurisdictions.find(j => j.id === entry.value)?.name ?? entry.value ?? 'Missing' : entry.value ?? 'Missing'}</strong></p>
        <p className="text-sm">Source: {entry.source ?? 'Not recorded'} {entry.href && <a className="text-blue-800 underline" href={entry.href} target="_blank" rel="noopener noreferrer">Inspect source</a>}</p>
        {entry.kind === 'politician' ? <label className="block text-sm">Correct jurisdiction<select className="field ml-2" value={corrections[entry.id] ?? ''} onChange={event => setCorrections(previous => ({ ...previous, [entry.id]: event.target.value }))}><option value="">Select a city</option>{queue?.jurisdictions.filter(j => j.type === 'city').map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
          : <label className="block text-sm">Correct {entry.kind === 'filing' ? 'filing year' : 'meeting date (UTC)'}<input className="field ml-2" type={entry.kind === 'filing' ? 'number' : 'date'} min={entry.kind === 'filing' ? 1900 : undefined} max={entry.kind === 'filing' ? 9999 : undefined} value={corrections[entry.id] ?? ''} onChange={event => setCorrections(previous => ({ ...previous, [entry.id]: event.target.value }))} /></label>}
        <div className="flex gap-3"><button type="button" className="button-secondary" disabled={busy !== null || !corrections[entry.id]} onClick={() => void submit(entry, 'correct')}>Save correction</button>
          <button type="button" className="button-primary" disabled={busy !== null || entry.value == null || entry.reason === 'POLITICIAN_IDENTITY_REVIEW'} onClick={() => void submit(entry, 'verify')}>Confirm reviewed value</button></div>
        {entry.reason === 'POLITICIAN_IDENTITY_REVIEW' && <p className="text-sm">Resolve identity review under Officials before confirming jurisdiction.</p>}
      </section>)}
    </main></div></AdminGuard>;
}