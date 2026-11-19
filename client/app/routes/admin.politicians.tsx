import { Check, Merge, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AdminGuard, AdminNav } from "../adminComponents";
import { adminFetch } from "../adminAuth";
import RequestError from "../components/RequestError";

type Politician = { id: string; slug: string; name: string; officeTitle: string; district: string; city: string; needsReview: boolean; filingCount: number };
type PoliticianForm = { name: string; district: string; city: string; officeTitle: string };
const emptyForm: PoliticianForm = { name: "", district: "", city: "", officeTitle: "" };

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error ?? "The request could not be completed.";
}

export function meta() { return [{ title: "Identity review | FAIR Investigations" }]; }

export default function AdminPoliticiansPage() {
  const [politicians, setPoliticians] = useState<Politician[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Politician | null>(null);
  const [merging, setMerging] = useState<Politician | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadPoliticians() {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/politicians");
      if (!response.ok) throw new Error(await responseError(response));
      setPoliticians((await response.json()).data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load politician list.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPoliticians(); }, []);

  function startEdit(politician: Politician) {
    setEditingId(politician.id);
    setForm({ name: politician.name, district: politician.district, city: politician.city, officeTitle: politician.officeTitle });
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() { setEditingId(null); setForm(emptyForm); }

  async function savePolitician(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.district.trim() || !form.city.trim()) { setError("Name, district, and city are required."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await adminFetch(`/api/admin/politicians${editingId ? `/${encodeURIComponent(editingId)}` : ""}`, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(editingId ? "Politician profile updated." : "Politician added to the master list.");
      resetForm(); await loadPoliticians();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save politician."); }
    finally { setSaving(false); }
  }

  async function approvePolitician(politician: Politician) {
    setActionId(politician.id); setError(null); setNotice(null);
    try {
      const response = await adminFetch(`/api/admin/politicians/${encodeURIComponent(politician.id)}/approve`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(`${politician.name} was approved and removed from the review queue.`); await loadPoliticians();
    } catch (approveError) { setError(approveError instanceof Error ? approveError.message : "Could not approve politician."); }
    finally { setActionId(null); }
  }

  async function reconcilePolitician() {
    if (!merging || !mergeTargetId) return;
    setActionId(merging.id); setError(null); setNotice(null);
    try {
      const response = await adminFetch(`/api/admin/politicians/${encodeURIComponent(merging.id)}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetPoliticianId: mergeTargetId }) });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json(); setNotice(payload.message ?? `${merging.name} was reconciled.`);
      setMerging(null); setMergeTargetId(""); await loadPoliticians();
    } catch (mergeError) { setError(mergeError instanceof Error ? mergeError.message : "Could not reconcile politicians."); }
    finally { setActionId(null); }
  }

  async function deletePolitician() {
    if (!deleting) return;
    setActionId(deleting.id); setError(null);
    try {
      const response = await adminFetch(`/api/admin/politicians/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(`${deleting.name} was deleted.`); setDeleting(null); await loadPoliticians();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Could not delete politician."); }
    finally { setActionId(null); }
  }

  const visiblePoliticians = politicians.filter((politician) => `${politician.name} ${politician.city} ${politician.district}`.toLowerCase().includes(search.toLowerCase()));
  return <AdminGuard><div className="min-h-screen bg-slate-50 text-slate-900"><AdminNav title="Politician master list" /><main className="mx-auto max-w-7xl space-y-6 px-5 py-8">
    <section className="surface p-5 sm:p-6"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{editingId ? "Edit politician" : "Add politician"}</h2><p className="mt-1 text-sm text-slate-600">Name, district, and city are required.</p></div>{editingId && <button className="inline-flex items-center gap-1 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" type="button" onClick={resetForm}><X size={16} /> Cancel edit</button>}</div>
      <form onSubmit={savePolitician} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{([ ["name", "Name"], ["district", "District"], ["city", "City"], ["officeTitle", "Office title"] ] as const).map(([field, label]) => <label key={field} className="text-sm font-medium text-slate-700">{label}{field !== "officeTitle" && <span className="text-red-700"> *</span>}<input required={field !== "officeTitle"} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="mt-1 w-full border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" /></label>)}<div className="flex items-end"><button disabled={saving} className="inline-flex items-center gap-2 bg-emerald-800 px-4 py-2.5 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50" type="submit"><Plus size={17} />{saving ? "Saving..." : editingId ? "Save changes" : "Add politician"}</button></div></form>
      {error && <RequestError message={error} onRetry={loadPoliticians} />}{notice && <p className="mt-4 border-l-4 border-emerald-700 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900" role="status">{notice}</p>}
      {deleting && <div className="mt-4 flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-3 text-sm"><span>Delete {deleting.name}? Profiles with linked records must be reconciled instead.</span><button disabled={actionId === deleting.id} type="button" onClick={deletePolitician} className="bg-red-800 px-3 py-1.5 font-medium text-white disabled:opacity-50">Confirm delete</button><button type="button" onClick={() => setDeleting(null)} className="px-3 py-1.5 text-slate-700 hover:bg-white">Cancel</button></div>}
      {merging && <div className="mt-4 border border-blue-300 bg-blue-50 p-4 text-sm"><p className="font-medium">Reconcile duplicate: {merging.name}</p><p className="mt-1 text-slate-700">Linked filings, votes, conflicts, and review history will move to the selected surviving profile.</p><div className="mt-3 flex flex-wrap items-center gap-2"><label htmlFor="merge-target" className="font-medium">Surviving profile</label><select id="merge-target" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="field max-w-sm"><option value="">Choose a profile</option>{politicians.filter((candidate) => candidate.id !== merging.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} — {candidate.city}, {candidate.district}</option>)}</select><button disabled={!mergeTargetId || actionId === merging.id} type="button" onClick={reconcilePolitician} className="bg-blue-800 px-3 py-2 font-medium text-white disabled:opacity-50">Confirm reconciliation</button><button type="button" onClick={() => { setMerging(null); setMergeTargetId(""); }} className="px-3 py-2 text-slate-700 hover:bg-white">Cancel</button></div></div>}
    </section>
    <section className="surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h2 className="font-semibold">Politicians</h2><p className="text-sm text-slate-600">{visiblePoliticians.length} of {politicians.length} records</p></div><input type="search" aria-label="Search politicians" placeholder="Search name, city, district" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full border border-slate-300 px-3 py-2 sm:max-w-xs" /></div>
      {loading ? <p className="p-6 text-sm text-slate-600">Loading politicians...</p> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Politician</th><th className="px-4 py-3">District</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Filings</th><th className="px-4 py-3">Review</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{visiblePoliticians.map((politician) => <tr key={politician.id} className="border-t border-slate-200"><td className="px-4 py-3"><a className="font-medium text-emerald-900 underline" href={`/politicians/${encodeURIComponent(politician.slug)}`}>{politician.name}</a><div className="text-xs text-slate-500">{politician.officeTitle}</div></td><td className="px-4 py-3">{politician.district}</td><td className="px-4 py-3">{politician.city}</td><td className="px-4 py-3 tabular-nums">{politician.filingCount}</td><td className="px-4 py-3">{politician.needsReview ? <span className="font-medium text-amber-800">Needs review</span> : <span className="text-slate-500">Ready</span>}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{politician.needsReview && <button title="Approve politician" aria-label={`Approve ${politician.name}`} disabled={actionId === politician.id} onClick={() => approvePolitician(politician)} className="p-2 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50" type="button"><Check size={17} /></button>}<button title="Reconcile duplicate" aria-label={`Reconcile ${politician.name}`} onClick={() => { setMerging(politician); setMergeTargetId(""); setError(null); }} className="p-2 text-blue-800 hover:bg-blue-50" type="button"><Merge size={17} /></button><button title="Edit politician" aria-label={`Edit ${politician.name}`} onClick={() => startEdit(politician)} className="p-2 text-slate-700 hover:bg-slate-100" type="button"><Pencil size={17} /></button><button title="Delete politician" aria-label={`Delete ${politician.name}`} onClick={() => { setDeleting(politician); setError(null); }} className="p-2 text-red-800 hover:bg-red-50" type="button"><Trash2 size={17} /></button></div></td></tr>)}{!visiblePoliticians.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{politicians.length ? "No politicians match this search." : "No politicians have been added."}</td></tr>}</tbody></table></div>}
    </section>
  </main></div></AdminGuard>;
}