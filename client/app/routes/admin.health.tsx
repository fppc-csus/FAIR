import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { AdminGuard, AdminNav } from "../adminComponents";
import { adminFetch } from "../adminAuth";

type Run = {
  id: string;
  source: string;
  sourceType?: string | null;
  startedAt: string;
  completedAt: string | null;
  status: string;
  itemsFound: number;
  documentsFound: number;
  pdfsFetched: number;
  documentsSkipped: number;
  itemsInserted: number;
  itemsSkipped: number;
  conflictsDetected: number;
  error: string | null;
  sourceLimitations: { url?: string; message: string }[];
  detectionErrors: { agendaItemCount: number; message: string }[];
  retryEligible: boolean;
};

type DetectionRun = {
  id: string;
  source: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  candidates: number;
  conflictsDetected: number;
  error: string | null;
};

type HealthData = {
  runs: Run[];
  detectionRuns: DetectionRun[];
  lastSuccessful: {
    legistar: { source: string; completedAt: string | null } | null;
    apify: { source: string; completedAt: string | null } | null;
  };
  runningJobs: Run[];
  rowCounts: Record<string, number>;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusClass(status: string) {
  if (status === "success") return "bg-green-100 text-green-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  if (status === "stale") return "bg-amber-100 text-amber-800";
  if (status === "running") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadHealth = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);

    try {
      setError(null);

      const response = await adminFetch("/api/admin/health");
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error ?? `Unable to load health data (${response.status})`,
        );
      }

      setData(body);
      setLastRefreshed(new Date());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load operational health data.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();

    const interval = window.setInterval(() => {
      loadHealth();
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [loadHealth]);

    async function handleRetry(run: Run) {
    setRetryingId(run.id);

    try {
      const response = await adminFetch(`/api/admin/health/runs/${run.id}/retry`, {
        method: "POST",
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Retry failed (${response.status})`);
      }

      await loadHealth(true);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Unable to retry this run.",
      );
    } finally {
      setRetryingId(null);
    }
  }
    if (loading && !data) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-slate-50">
          <AdminNav title="System health" />
          <main className="grid min-h-[60vh] place-items-center px-4">
            <p className="surface p-6 text-sm text-slate-600" role="status">
              Loading operational health…
            </p>
          </main>
        </div>
      </AdminGuard>
    );
  }

  if (error && !data) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-slate-50">
          <AdminNav title="System health" />
          <main className="mx-auto max-w-7xl px-4 py-10">
            <div className="rounded-xl bg-red-100 px-4 py-3 text-sm font-medium text-red-800" role="alert">
              {error}
            </div>
            <button
              type="button"
              className="button-primary mt-4"
              onClick={() => loadHealth(true)}
            >
              Try again
            </button>
          </main>
        </div>
      </AdminGuard>
    );
  }

  if (!data) return null;

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-50 text-slate-950">
        <AdminNav title="System health" />

        <main className="mx-auto max-w-7xl px-4 py-10 md:px-10">
          <div className="surface px-6 py-8 md:px-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Operational monitoring</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
                  Ingestion and detection health
                </h2>
                <p className="mt-3 text-sm text-slate-600">
                  Monitor recent jobs, database totals, and recoverable failures.
                </p>
                {lastRefreshed && (
                  <p className="mt-2 text-xs text-slate-500">
                    Last refreshed: {lastRefreshed.toLocaleTimeString()}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="button-secondary inline-flex items-center gap-2"
                onClick={() => loadHealth(true)}
                disabled={refreshing}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {error && (
              <div className="mt-6 rounded-xl bg-amber-100 px-4 py-3 text-sm font-medium text-amber-900" role="alert">
                Some health data could not be refreshed: {error}
              </div>
            )}

            <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Last successful runs">
              {(["legistar", "apify"] as const).map((sourceType) => {
                const run = data.lastSuccessful[sourceType];

                return (
                  <div key={sourceType} className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Last successful {sourceType} run
                    </p>
                    <p className="mt-3 text-lg font-semibold">
                      {run?.source ?? "No successful run recorded"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {run ? formatDate(run.completedAt) : "—"}
                    </p>
                  </div>
                );
              })}
            </section>
                        <section className="mt-8" aria-labelledby="row-counts-heading">
              <h3 id="row-counts-heading" className="text-lg font-semibold">
                Operational row counts
              </h3>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(data.rowCounts).map(([name, count]) => (
                  <div
                    key={name}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <p className="text-sm capitalize text-slate-500">
                      {name.replace(/([A-Z])/g, " $1")}
                    </p>
                    <p className="mt-1 text-2xl font-bold">{count}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="running-jobs-heading">
              <h3 id="running-jobs-heading" className="text-lg font-semibold">
                Current running jobs
              </h3>

              {data.runningJobs.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                  No jobs are currently running.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Source</th>
                        <th className="px-4 py-3 font-semibold">Started</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {data.runningJobs.map((run) => (
                        <tr key={run.id}>
                          <td className="px-4 py-3">{run.source}</td>
                          <td className="px-4 py-3">{formatDate(run.startedAt)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(run.status)}`}>
                              {statusLabel(run.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
                        <section className="mt-8" aria-labelledby="sync-runs-heading">
              <h3 id="sync-runs-heading" className="text-lg font-semibold">
                Recent sync runs
              </h3>

              {data.runs.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                  No sync runs have been recorded yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Source</th>
                        <th className="px-4 py-3 font-semibold">Started</th>
                        <th className="px-4 py-3 font-semibold">Completed</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Counts</th>
                        <th className="px-4 py-3 font-semibold">Errors / limitations</th>
                        <th className="px-4 py-3 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {data.runs.map((run) => (
                        <tr key={run.id}>
                          <td className="px-4 py-3">
                            <div className="font-medium">{run.source}</div>
                            <div className="text-xs text-slate-500">
                              {run.sourceType ?? "unknown"}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatDate(run.startedAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatDate(run.completedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(run.status)}`}>
                              {statusLabel(run.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            Found: {run.itemsFound}
                            {run.documentsFound > 0 && (
                              <>
                                <br />
                                Documents: {run.documentsFound}; PDFs fetched: {run.pdfsFetched}; documents skipped: {run.documentsSkipped}
                              </>
                            )}
                            <br />
                            Inserted: {run.itemsInserted}
                            <br />
                            Skipped: {run.itemsSkipped}
                            <br />
                            Conflicts: {run.conflictsDetected}
                          </td>
                          <td className="max-w-sm px-4 py-3 text-xs text-red-700">
                            {run.sourceLimitations.length > 0 || run.detectionErrors.length > 0 ? (
                              <ul className="space-y-2">
                                {run.sourceLimitations.map((limitation, index) => (
                                  <li key={`${limitation.url ?? "source"}-${index}`}>
                                    {limitation.url && (
                                      <a
                                        className="break-all underline"
                                        href={limitation.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Source document
                                      </a>
                                    )}
                                    {limitation.url ? ": " : ""}
                                    {limitation.message}
                                  </li>
                                ))}
                                {run.detectionErrors.map((detectionError, index) => (
                                  <li key={`detection-${index}`}>
                                    Detection error{detectionError.agendaItemCount > 0
                                      ? ` (${detectionError.agendaItemCount} agenda item${detectionError.agendaItemCount === 1 ? "" : "s"})`
                                      : ""}: {detectionError.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              run.error ?? "—"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {run.retryEligible ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                                onClick={() => handleRetry(run)}
                                disabled={retryingId === run.id}
                              >
                                <RotateCcw size={14} aria-hidden="true" />
                                {retryingId === run.id ? "Retrying…" : "Retry"}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-8" aria-labelledby="detection-runs-heading">
              <h3 id="detection-runs-heading" className="text-lg font-semibold">
                Recent detection runs
              </h3>

              {data.detectionRuns.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                  No detection runs have been recorded yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Source</th>
                        <th className="px-4 py-3 font-semibold">Started</th>
                        <th className="px-4 py-3 font-semibold">Completed</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Counts</th>
                        <th className="px-4 py-3 font-semibold">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {data.detectionRuns.map((run) => (
                        <tr key={run.id}>
                          <td className="px-4 py-3">{run.source}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatDate(run.startedAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatDate(run.completedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(run.status)}`}>
                              {statusLabel(run.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            Candidates: {run.candidates}
                            <br />
                            Conflicts: {run.conflictsDetected}
                          </td>
                          <td className="max-w-xs px-4 py-3 text-xs text-red-700">
                            {run.error ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}