import { useEffect, useState } from "react";
import { adminFetch } from "../adminAuth";

type DemoStatus = {
  exists: boolean;
  passed: boolean;
  official?: string;
  vendor?: string;
  conflictIds?: string[];
  controlConflictCount?: number;
};

export default function SyntheticConflictCheck() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestStatus(method = "GET") {
    setBusy(true);
    setError(null);
    try {
      const response = await adminFetch("/api/admin/sources/demo-conflict", { method });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Synthetic check failed.");
      setStatus(method === "DELETE" ? { exists: false, passed: false } : body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Synthetic check failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void requestStatus(); }, []);

  return <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5" aria-label="Synthetic conflict engine check">
    <h3 className="text-lg font-semibold">Fictional conflict-engine check</h3>
    <p className="mt-2 text-sm">Creates a clearly fictional official, a $5,000 Schedule C disclosure,
      one matching agenda, and one nonmatching agenda. The real engine must create one INCOME flag,
      no control flag, and no duplicates on a second run. Demo records are excluded from public results.</p>
    {status && <p className="mt-3 font-medium" role="status">
      {status.passed ? "Passed: matching conflict stored; negative control clear." : status.exists ? "Fixture exists; verification has not passed." : "No synthetic fixture installed."}
    </p>}
    {status?.passed && <p className="mt-2 break-all text-sm">{status.official} · {status.vendor}<br />Stored conflict ID: {status.conflictIds?.join(", ")}</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <div className="mt-4 flex gap-3">
      <button type="button" className="button-primary" disabled={busy} onClick={() => void requestStatus("POST")}>{busy ? "Working…" : "Run fictional conflict check"}</button>
      <button type="button" className="rounded border px-3 py-2" disabled={busy || !status?.exists} onClick={() => void requestStatus("DELETE")}>Remove fictional test data</button>
    </div>
  </section>;
}