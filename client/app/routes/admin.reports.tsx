import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { AdminGuard, AdminNav } from "../adminComponents";
import { adminFetch } from "../adminAuth";
import RequestError from "../components/RequestError";

type Scope = "all" | "politician" | "city" | "dateRange";
type Politician = { id: string; name: string; city: string };
const scopeOptions: { value: Scope; label: string; description: string }[] = [
  { value: "all", label: "All conflicts", description: "Include every detected conflict." },
  { value: "politician", label: "Politician", description: "Limit the report to one official." },
  { value: "city", label: "City", description: "Limit the report to one jurisdiction." },
  { value: "dateRange", label: "Date range", description: "Limit the report by conflict date." },
];

export function meta() { return [{ title: "Conflict reports | FAIR Investigations" }]; }

export default function AdminReportsPage() {
  const [scope, setScope] = useState<Scope>("all");
  const [politicianId, setPoliticianId] = useState("");
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [politicians, setPoliticians] = useState<Politician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminFetch("/api/admin/politicians")
      .then(async response => {
        if (!response.ok) throw new Error("Could not load officials for report filters.");
        const result = await response.json();
        if (active) setPoliticians(result.data);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load report filters."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const cities = [...new Set(politicians.map(politician => politician.city).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const selectedPolitician = politicians.find(politician => politician.id === politicianId);
  const scopeSummary = scope === "all" ? "All conflicts" : scope === "politician" ? selectedPolitician?.name ?? "Choose a politician" : scope === "city" ? city || "Choose a city" : `${startDate || "Start date"} to ${endDate || "End date"}`;
  const scopeReady = scope === "all"
    || (scope === "politician" && Boolean(politicianId))
    || (scope === "city" && Boolean(city))
    || (scope === "dateRange" && Boolean(startDate && endDate && startDate <= endDate));

  async function downloadReport() {
    setDownloading(true);
    setDownloadError(null);
    const filters = scope === "politician" ? { scope, politicianId }
      : scope === "city" ? { scope, city }
        : scope === "dateRange" ? { scope, startDate, endDate }
          : { scope };
    try {
      const response = await adminFetch("/api/admin/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not generate the conflict report.");
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
        ?? `fair-conflict-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (downloadFailure) {
      setDownloadError(downloadFailure instanceof Error ? downloadFailure.message : "Could not generate the conflict report.");
    } finally {
      setDownloading(false);
    }
  }

  return <AdminGuard>
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AdminNav title="Conflict reports" />
      <main className="mx-auto max-w-5xl space-y-6 px-5 py-8">
        <header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">FAIR Admin</p><h2 className="mt-2 text-2xl font-semibold">Create a conflict report</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Choose which conflicts to include in your report.</p></header>
        {error && <RequestError message={error} onRetry={() => setAttempt(value => value + 1)} />}
        <section className="surface p-5 sm:p-6" aria-labelledby="report-scope-heading">
          <h3 id="report-scope-heading" className="font-semibold">Report scope</h3>
          <fieldset className="mt-4 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Choose report scope</legend>
            {scopeOptions.map(option => <label key={option.value} className={`flex cursor-pointer gap-3 border p-4 transition ${scope === option.value ? "border-emerald-800 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
              <input type="radio" name="report-scope" value={option.value} checked={scope === option.value} onChange={() => setScope(option.value)} className="mt-1 accent-emerald-800" />
              <span><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-sm text-slate-600">{option.description}</span></span>
            </label>)}
          </fieldset>

          {scope === "politician" && <div className="mt-5 max-w-xl">
            <label htmlFor="report-politician" className="block text-sm font-medium text-slate-700">Politician</label>
            <select id="report-politician" value={politicianId} onChange={event => setPoliticianId(event.target.value)} disabled={loading} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-100">
              <option value="">{loading ? "Loading officials…" : "Select a politician"}</option>
              {politicians.map(politician => <option key={politician.id} value={politician.id}>{politician.name}{politician.city ? ` · ${politician.city}` : ""}</option>)}
            </select>
          </div>}

          {scope === "city" && <div className="mt-5 max-w-xl">
            <label htmlFor="report-city" className="block text-sm font-medium text-slate-700">City</label>
            <select id="report-city" value={city} onChange={event => setCity(event.target.value)} disabled={loading} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-100">
              <option value="">{loading ? "Loading cities…" : "Select a city"}</option>
              {cities.map(cityName => <option key={cityName} value={cityName}>{cityName}</option>)}
            </select>
          </div>}

          {scope === "dateRange" && <div className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-100" /></label>
            <label className="block text-sm font-medium text-slate-700">End date<input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-100" /></label>
          </div>}
        </section>

        <section className="surface flex flex-wrap items-center justify-between gap-3 p-4" aria-live="polite">
          <div><h3 className="text-sm font-semibold">Selected scope</h3><p className="mt-1 text-sm text-slate-600">{scopeSummary}</p></div>
          <button type="button" onClick={downloadReport} disabled={loading || downloading || !scopeReady} className="inline-flex items-center gap-2 bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">
            <Download size={16} />{downloading ? "Generating PDF…" : "Download PDF"}
          </button>
        </section>
        {downloadError && <p className="border-l-4 border-red-700 bg-red-50 px-3 py-2.5 text-sm text-red-900" role="alert">{downloadError}</p>}
        {loading && <span className="text-sm text-slate-500" role="status">Loading report filters…</span>}
      </main>
    </div>
  </AdminGuard>;
}