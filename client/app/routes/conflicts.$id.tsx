import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ExternalLink, FileText, Gavel, History, Landmark, ScrollText } from "lucide-react";
import { useApiData } from "../hooks/useApiData";
import RequestError from "../components/RequestError";
import { investigatorFetch } from "../adminAuth";
import { safeMessage } from "../lib/request";
import { DetailsList, IdentityBadge, ReviewBadge, SeverityBadge, formatDate, titleCase, type DetailPair } from "../components/investigator";

type Review = { id: string; adminUserId: string; reviewedAt: string; oldStatus: string; newStatus: string; note: string };
export type ConflictDetailData = {
  id: string;
  politician: { id: string; slug?: string | null; name: string; officeTitle?: string | null; district: string | null; jurisdiction?: string | null; identityVerified?: boolean | null };
  conflictType: string;
  severity: string;
  ruleReference: string;
  entityName: string | null;
  filingYear?: number | null;
  detectedAt?: string | null;
  reviewStatus?: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  reviews?: Review[];
  scheduleEntry: { scheduleType: string; entityName: string | null; dollarValue: string | null; natureOfInterest: string | null; details?: DetailPair[] } | null;
  agendaItem: {
    id?: string; title: string | null; text: string | null; meetingDate: string | null; city: string | null;
    bodyName?: string | null; agendaNumber?: string | null; sourceUrl?: string | null; legistarMatterId?: string | null;
    evidence?: { before: string; match: string; after: string } | null;
  };
};

const REVIEW_OPTIONS = [
  ["pending", "Awaiting review"],
  ["confirmed_conflict", "Confirmed conflict — refer for enforcement"],
  ["not_applicable", "Not applicable — no disqualifying interest"],
] as const;

function severityExplanation(conflict: ConflictDetailData) {
  const amount = conflict.scheduleEntry?.dollarValue;
  if (conflict.conflictType === "BUSINESS_POSITION") return "A reported business position matched this agenda item.";
  if (!amount) return "The reported interest matched this agenda item; its value could not be confirmed from the filing.";
  if (conflict.severity === "HIGH") return `Reported value ${amount} falls in the high band (from $10,000).`;
  if (conflict.severity === "MEDIUM") return `Reported value ${amount} falls in the medium band ($1,000–$9,999).`;
  return `Reported value ${amount} falls in the low band.`;
}

function ReviewPanel({ conflict, onSaved }: { conflict: ConflictDetailData; onSaved: () => void }) {
  const [status, setStatus] = useState(conflict.reviewStatus ?? "pending");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      const response = await investigatorFetch(`/api/admin/conflicts/${conflict.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(safeMessage(payload.error, "The review could not be saved."));
      }
      setNote("");
      onSaved();
    } catch (reason) {
      setError(safeMessage(reason, "The review could not be saved."));
    } finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="space-y-4" aria-label="Record review decision">
    <label className="block text-sm font-semibold">Decision<select className="field mt-2" value={status} onChange={(event) => setStatus(event.target.value)}>{REVIEW_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="block text-sm font-semibold">Investigator note<textarea className="field mt-2 min-h-28" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} required placeholder="What you checked: recusal record, vote, timing of income, relationship to the entity…" /></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="submit" className="button-primary" disabled={saving || !note.trim()}>{saving ? "Saving…" : "Save review"}</button>
  </form>;
}

export function meta() { return [{ title: "Conflict | FAIR Investigations" }]; }

export default function ConflictDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const back = `/conflicts${params.size ? `?${params.toString()}` : ""}`;
  const { data: conflict, loading, error, retry } = useApiData<ConflictDetailData>(`/api/conflicts/${encodeURIComponent(id ?? "")}`);
  const profileHref = conflict ? `/politicians/${encodeURIComponent(conflict.politician.slug ?? conflict.politician.id)}` : "#";
  const evidence = conflict?.agendaItem.evidence;

  return <div className="page-shell">
    <Link to={back} className="text-sm font-semibold text-blue-700 hover:underline">← Back to conflicts</Link>
    {loading && <p className="mt-12" role="status">Loading conflict…</p>}
    {error && <RequestError message={error} onRetry={retry} />}
    {!loading && !error && conflict && <>
      <header className="mt-7 border-b border-slate-200 pb-7">
        <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={conflict.severity} /><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-900">{titleCase(conflict.conflictType)}</span><ReviewBadge status={conflict.reviewStatus} /><IdentityBadge verified={conflict.politician.identityVerified} /></div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl"><Link to={profileHref} className="hover:text-blue-800">{conflict.politician.name}</Link></h1>
        <p className="mt-2 text-slate-600">{[conflict.politician.officeTitle, conflict.politician.jurisdiction, conflict.politician.district && `District ${conflict.politician.district}`].filter(Boolean).join(" · ") || "Office not recorded"}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Matched entity</dt><dd className="font-semibold">{conflict.entityName ?? "Not recorded"}</dd></div>
          <div><dt className="text-slate-500">Meeting</dt><dd className="font-semibold">{formatDate(conflict.agendaItem.meetingDate, { year: "numeric", month: "long", day: "numeric" })}</dd></div>
          <div><dt className="text-slate-500">Form 700 year</dt><dd className="font-semibold">{conflict.filingYear ?? "Not recorded"}</dd></div>
          <div><dt className="text-slate-500">Detected</dt><dd className="font-semibold">{formatDate(conflict.detectedAt)}</dd></div>
        </dl>
      </header>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section className="surface p-6" aria-labelledby="evidence-heading">
            <div className="flex items-center gap-2"><ScrollText size={19} className="text-blue-700" /><h2 id="evidence-heading" className="text-xl font-bold">Agenda evidence</h2></div>
            <p className="mt-2 text-sm text-slate-600">{[conflict.agendaItem.city, conflict.agendaItem.bodyName, conflict.agendaItem.agendaNumber && `Item ${conflict.agendaItem.agendaNumber}`].filter(Boolean).join(" · ")}</p>
            {conflict.agendaItem.title && <h3 className="mt-4 font-semibold">{conflict.agendaItem.title}</h3>}
            {evidence ? <blockquote className="mt-4 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 text-sm leading-7 text-slate-800">{evidence.before}<mark className="rounded bg-amber-200 px-0.5 font-semibold text-slate-950">{evidence.match}</mark>{evidence.after}</blockquote>
              : <p className="mt-4 text-sm text-slate-600">The matched name was not found verbatim in the stored text (fuzzy or AI-assisted match). Read the full text below.</p>}
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              {conflict.agendaItem.sourceUrl && <a className="inline-flex items-center gap-1 font-semibold text-blue-700" href={conflict.agendaItem.sourceUrl} target="_blank" rel="noreferrer">Original agenda <ExternalLink size={14} /></a>}
              {conflict.agendaItem.id && <Link className="font-semibold text-blue-700" to={`/agenda/${conflict.agendaItem.id}`}>All flags on this item →</Link>}
            </div>
            <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Full agenda text</summary><p className="mt-3 max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-7 text-slate-700">{conflict.agendaItem.text ?? "No text stored."}</p></details>
          </section>

          <section className="surface p-6" aria-labelledby="disclosure-heading">
            <div className="flex items-center gap-2"><FileText size={19} className="text-blue-700" /><h2 id="disclosure-heading" className="text-xl font-bold">Form 700 disclosure</h2></div>
            {conflict.scheduleEntry ? <>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-sm text-slate-500">Schedule</dt><dd className="font-medium">Schedule {conflict.scheduleEntry.scheduleType}</dd></div>
                <div><dt className="text-sm text-slate-500">Entity, source or property</dt><dd className="font-medium">{conflict.scheduleEntry.entityName ?? "Not reported"}</dd></div>
                <div><dt className="text-sm text-slate-500">Reported value</dt><dd className="font-medium">{conflict.scheduleEntry.dollarValue ?? "Not reported"}</dd></div>
                <div><dt className="text-sm text-slate-500">Nature of interest / position</dt><dd className="font-medium">{conflict.scheduleEntry.natureOfInterest ?? "Not reported"}</dd></div>
              </dl>
              <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Everything reported on this line</h3>
              <div className="mt-3"><DetailsList details={conflict.scheduleEntry.details} empty="Only the summary columns above were available for this filing." /></div>
            </> : <p className="mt-3 text-sm text-slate-600">The supporting disclosure row could not be located; it may have been replaced by a newer import.</p>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="surface p-6" aria-labelledby="basis-heading">
            <div className="flex items-center gap-2"><Gavel size={19} className="text-blue-700" /><h2 id="basis-heading" className="text-lg font-bold">Basis</h2></div>
            <p className="mt-3 text-sm leading-6">{severityExplanation(conflict)}</p>
            <p className="mt-3 text-sm"><strong>Rule:</strong> {conflict.ruleReference}</p>
            <p className="mt-3 text-xs text-slate-500">Check recusal, participation, the 12-month income window, and whether the decision's effect on the interest is reasonably foreseeable and material (2 CCR §18700 et seq.).</p>
          </section>
          <section className="surface p-6" aria-labelledby="review-heading">
            <div className="flex items-center gap-2"><Landmark size={19} className="text-blue-700" /><h2 id="review-heading" className="text-lg font-bold">Review decision</h2></div>
            {conflict.reviewNote && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><span className="font-semibold">Current note:</span> {conflict.reviewNote}</p>}
            <div className="mt-4"><ReviewPanel conflict={conflict} onSaved={retry} /></div>
          </section>
          <section className="surface p-6" aria-labelledby="history-heading">
            <div className="flex items-center gap-2"><History size={19} className="text-blue-700" /><h2 id="history-heading" className="text-lg font-bold">Review history</h2></div>
            {(conflict.reviews ?? []).length === 0 ? <p className="mt-3 text-sm text-slate-600">No reviews recorded yet.</p>
              : <ol className="mt-3 space-y-3">{conflict.reviews!.map((review) => <li key={review.id} className="border-l-2 border-slate-200 pl-3 text-sm"><p className="font-semibold">{titleCase(review.oldStatus)} → {titleCase(review.newStatus)}</p><p className="text-xs text-slate-500">{formatDate(review.reviewedAt, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p><p className="mt-1 text-slate-700">{review.note}</p></li>)}</ol>}
          </section>
        </aside>
      </div>
    </>}
  </div>;
}
