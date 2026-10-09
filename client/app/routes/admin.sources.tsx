import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "react-hot-toast";
import { AdminGuard, AdminNav } from "../adminComponents";
import { adminFetch } from "../adminAuth";
import CityAgendaDiscovery from "../components/CityAgendaDiscovery";

type Source = {
  id: string;
  cityName: string;
  sourceType: "legistar" | "apify" | "pdf" | "Legistar" | "Apify" | "PDF";
  legistarBaseUrl?: string | null;
  apifyActorId?: string | null;
  lastSyncTime: string | null;
  totalAgendaItems: number;
  lastError: string | null;
  status: "ready" | "running" | "success" | "failed" | "disabled";
};

function formatDate(date: string | null) {
  if (!date) return "Never";
  return new Date(date).toLocaleString();
}

function statusLabel(status: Source["status"]) {
  return status === "ready" ? "Ready" : status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: Source["status"]) {
  if (status === "running") return "bg-blue-100 text-blue-800";
  if (status === "success" || status === "ready") return "bg-green-100 text-green-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

export default function AdminSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [cityName, setCityName] = useState("");
  const [sourceType, setSourceType] = useState<"Legistar" | "Apify">("Legistar");
  const [legistarBaseUrl, setLegistarBaseUrl] = useState("");
  const [apifyActorId, setApifyActorId] = useState("");

  async function loadSources() {
    setLoading(true);
    try {
      setLoadError(null);
      const res = await adminFetch("/api/admin/sources");

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? body?.message ?? `Failed to fetch sources (${res.status})`);
      }

      const data = await res.json();
      setSources(data);
    } catch (err) {
      console.error("Failed to fetch sources", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load source data.");
    } finally {
      setLoading(false);
      setLastRefreshed(new Date());
    }
  }

  useEffect(() => {
    loadSources();

    const interval = setInterval(() => {
      loadSources();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const res = await adminFetch(`/api/admin/sources/${id}/sync`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? body?.message ?? `Could not start sync (${res.status})`);
      }

      const { syncLogId } = await res.json();
      if (!syncLogId) throw new Error("The server did not return a sync run ID.");
      setSources((current) => current.map((source) => source.id === id ? { ...source, status: "running" } : source));

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const statusResponse = await adminFetch(`/api/admin/sources/${id}/sync/${syncLogId}`);
        const sync = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok) {
          throw new Error(sync?.error ?? `Could not check sync status (${statusResponse.status})`);
        }

        setSources((current) => current.map((source) => source.id === id ? { ...source, status: sync.status } : source));
        if (sync.status === "failed") throw new Error(sync.error ?? "The source sync failed.");
        if (sync.status === "success") {
          toast.success(`Sync complete: ${sync.itemsInserted} new agenda items`);
          await loadSources();
          return;
        }
      }

      throw new Error("Sync is taking longer than expected. Refresh the source list to check its status.");
    } catch (err) {
      console.error("Sync failed", err);
      toast.error(err instanceof Error ? err.message : "Sync failed");
      await loadSources();
    } finally {
      setSyncingId(null);
    }
  }

  function resetSourceForm() {
    setEditingSourceId(null);
    setCityName("");
    setSourceType("Legistar");
    setLegistarBaseUrl("");
    setApifyActorId("");
    setAddError(null);
  }

  function startEditingSource(source: Source) {
    setEditingSourceId(source.id);
    setCityName(source.cityName);
    setSourceType(source.sourceType.toLowerCase() === "apify" ? "Apify" : "Legistar");
    setLegistarBaseUrl(source.legistarBaseUrl ?? "");
    setApifyActorId(source.apifyActorId ?? "");
    setAddError(null);
    setShowAddForm(true);
  }

  async function handleAddSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setAddError(null);

    try {
      const res = await adminFetch(`/api/admin/sources${editingSourceId ? `/${editingSourceId}` : ""}`, {
        method: editingSourceId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cityName,
          sourceType,
          ...(sourceType === "Legistar" ? { legistarBaseUrl } : { apifyActorId }),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? body?.message ?? `Failed to ${editingSourceId ? "update" : "add"} source (${res.status})`);
      }

      const wasEditing = editingSourceId !== null;
      resetSourceForm();
      setShowAddForm(false);
      toast.success(wasEditing ? "Source updated" : "Source added");
      await loadSources();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to save source.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteSource(source: Source) {
    const confirmed = window.confirm(
      `Delete the ${source.cityName} source? Existing agenda items will be preserved.`,
    );
    if (!confirmed) return;

    setDeletingId(source.id);
    try {
      const res = await adminFetch(`/api/admin/sources/${source.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? body?.message ?? `Failed to delete source (${res.status})`);
      }

      toast.success("Source deleted; ingested agenda items were kept");
      await loadSources();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete source.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-50 text-slate-950">
        <AdminNav title="Sources dashboard" />

      <main className="px-4 py-10 md:px-10">
        <div className="surface mx-auto max-w-6xl px-6 py-8 md:px-10">
          <div className="mb-8">
            <p className="eyebrow">Agenda ingestion</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
              Data sources
            </h2>
            <p className="mt-3 text-sm text-slate-600 md:text-base">
              View ingestion source status and trigger manual syncs.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          </div>

          <div className="mb-6 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (showAddForm) {
                  resetSourceForm();
                  setShowAddForm(false);
                } else {
                  resetSourceForm();
                  setShowAddForm(true);
                }
              }}
              aria-expanded={showAddForm}
              className="button-primary"
            >
              {showAddForm ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
              {showAddForm ? "Close" : "Add source"}
            </button>
          </div>

          {showAddForm && (
              <form onSubmit={handleAddSource} className="surface mb-8 bg-slate-50 px-5 py-6">
              <h3 className="mb-5 text-lg font-semibold text-gray-900">{editingSourceId ? "Edit ingestion source" : "New ingestion source"}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="source-city" className="mb-1 block text-sm font-medium text-gray-800">City name</label>
                  <input
                    id="source-city"
                    name="cityName"
                    value={cityName}
                    onChange={(event) => setCityName(event.target.value)}
                    autoComplete="address-level2"
                    required
                    className="field"
                  />
                </div>
                <div>
                  <label htmlFor="source-type" className="mb-1 block text-sm font-medium text-gray-800">Source type</label>
                  <select
                    id="source-type"
                    name="sourceType"
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value as "Legistar" | "Apify")}
                    className="field"
                  >
                    <option value="Legistar">Legistar</option>
                    <option value="Apify">Apify</option>
                  </select>
                </div>
                {sourceType === "Legistar" ? (
                  <div className="md:col-span-2">
                    <label htmlFor="source-legistar-url" className="mb-1 block text-sm font-medium text-gray-800">Legistar base URL</label>
                    <input
                      id="source-legistar-url"
                      name="legistarBaseUrl"
                      type="url"
                      value={legistarBaseUrl}
                      onChange={(event) => setLegistarBaseUrl(event.target.value)}
                      placeholder="https://webapi.legistar.com/v1/sacramento"
                      required
                      className="field"
                    />
                  </div>
                ) : (
                  <div className="md:col-span-2">
                    <label htmlFor="source-apify-actor" className="mb-1 block text-sm font-medium text-gray-800">Apify actor ID</label>
                    <input
                      id="source-apify-actor"
                      name="apifyActorId"
                      value={apifyActorId}
                      onChange={(event) => setApifyActorId(event.target.value)}
                      placeholder="username/actor-name"
                      required
                      className="field"
                    />
                  </div>
                )}
              </div>
              {addError && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{addError}</p>}
              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="button-primary"
                >
                  {isSaving ? "Saving..." : editingSourceId ? "Save changes" : "Save source"}
                </button>
              </div>
            </form>
          )}

          <CityAgendaDiscovery />

          {loadError && (
            <div className="mb-6 rounded-xl bg-red-100 px-4 py-3 text-sm font-medium text-red-800">
              {loadError}
            </div>
          )}

          {loading ? (
            <div className="surface px-6 py-10 text-center text-base text-slate-600">
              Loading sources...
            </div>
          ) : (
            <div className="surface overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-900">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-4 text-left font-semibold">City</th>
                      <th className="px-4 py-4 text-left font-semibold">Source Type</th>
                      <th className="px-4 py-4 text-left font-semibold">Last Sync</th>
                      <th className="px-4 py-4 text-left font-semibold">Agenda Items</th>
                      <th className="px-4 py-4 text-left font-semibold">Status</th>
                      <th className="px-4 py-4 text-left font-semibold">Last Error</th>
                      <th className="px-4 py-4 text-left font-semibold">Action</th>
                    </tr>
                  </thead>

                  <tbody className="bg-white">
                    {sources.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          No data sources found.
                        </td>
                      </tr>
                    ) : (
                      sources.map((source, index) => (
                        <tr key={source.id} className={index !== sources.length - 1 ? "border-b border-gray-200" : ""}>
                          <td className="px-4 py-4">{source.cityName}</td>
                          <td className="px-4 py-4 capitalize">{source.sourceType}</td>
                          <td className="px-4 py-4">{formatDate(source.lastSyncTime)}</td>
                          <td className="px-4 py-4">{source.totalAgendaItems}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${statusClass(source.status)}`}>
                              {statusLabel(source.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            {source.lastError ? (
                              <span className="text-red-700">{source.lastError}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                title="Edit source"
                                aria-label={`Edit ${source.cityName} source`}
                                onClick={() => startEditingSource(source)}
                                className="rounded-md border border-gray-300 p-2 text-gray-700 transition hover:bg-gray-100"
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSync(source.id)}
                                disabled={syncingId === source.id}
                                className="button-primary px-3 py-2"
                              >
                                {syncingId === source.id ? "Syncing..." : "Sync now"}
                              </button>
                              <button
                                type="button"
                                title="Delete source"
                                aria-label={`Delete ${source.cityName} source`}
                                onClick={() => handleDeleteSource(source)}
                                disabled={deletingId === source.id}
                                className="rounded-md border border-red-200 p-2 text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
      </div>
    </AdminGuard>
  );
}