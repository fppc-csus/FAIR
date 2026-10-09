import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileUp, Upload } from "lucide-react";
import { AdminGuard, AdminNav } from "../adminComponents";
import { adminFetch, clearAdminSession, getAdminAccessToken } from "../adminAuth";

type Politician = { id: string; name: string; city: string; district: string };
type UploadSummary = {
  filing_id: string;
  politician_id: string;
  politician: { name: string; slug: string } | null;
  schedules_parsed: { A: number; B: number; CDE: number; A2: number };
};

function errorMessage(payload: unknown) {
  return typeof payload === "object" && payload && "error" in payload
    ? String(payload.error)
    : "The upload could not be completed.";
}

export default function AdminUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [politicians, setPoliticians] = useState<Politician[]>([]);
  const [politicianId, setPoliticianId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adminFetch("/api/admin/politicians")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load politicians.");
        const result = await response.json();
        setPoliticians(result.data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load politicians."));
  }, []);

  function chooseFile(candidate: File | undefined) {
    setSummary(null);
    setProgress(0);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError("Only .xlsx files are accepted. Choose a Form 700 workbook.");
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      setFile(null);
      setError("This file is larger than the 10 MB upload limit.");
      return;
    }
    setError(null);
    setFile(candidate);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function uploadFile() {
    if (!file || uploading) return;
    setError(null);
    setSummary(null);
    setProgress(0);
    setUploading(true);

    try {
      const token = await getAdminAccessToken();
      const body = new FormData();
      body.append("file", file);
      if (politicianId) body.append("politician_id", politicianId);

      const result = await new Promise<UploadSummary>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api/admin/upload/form700`);
        request.setRequestHeader("Authorization", `Bearer ${token}`);
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        request.onload = () => {
          let payload: unknown;
          try {
            payload = JSON.parse(request.responseText);
          } catch {
            payload = null;
          }
          if (request.status === 401) {
            clearAdminSession();
            window.location.assign("/admin/login");
            reject(new Error("Your admin session has expired."));
            return;
          }
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(errorMessage(payload)));
            return;
          }
          resolve(payload as UploadSummary);
        };
        request.onerror = () => reject(new Error("Network error while uploading the workbook."));
        request.send(body);
      });
      setProgress(100);
      setSummary(result);
      setFile(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The upload could not be completed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <AdminNav title="Form 700 upload" />
        <main className="mx-auto max-w-5xl space-y-6 px-5 py-8">
          <section className="surface p-5 sm:p-7">
            <div className="mb-5 flex items-start gap-3">
              <div className="bg-emerald-100 p-2 text-emerald-900"><FileUp size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold">Upload filing workbook</h2>
                <p className="mt-1 text-sm text-slate-600">Form 700 XLSX files only. Maximum size: 10 MB.</p>
              </div>
            </div>

            <label className="mb-2 block text-sm font-medium" htmlFor="politician">Match to politician <span className="font-normal text-slate-500">(optional)</span></label>
            <select id="politician" value={politicianId} onChange={(event) => setPoliticianId(event.target.value)} className="field mb-5 max-w-xl">
              <option value="">Automatically match from cover page</option>
              {politicians.map((politician) => <option key={politician.id} value={politician.id}>{politician.name} · {politician.city || politician.district}</option>)}
            </select>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-52 w-full flex-col items-center justify-center border-2 border-dashed px-5 text-center transition ${dragging ? "border-emerald-700 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-emerald-700"}`}
            >
              <Upload className="mb-3 text-emerald-800" size={28} />
              <span className="font-semibold">{file ? file.name : "Drop an XLSX workbook here"}</span>
              <span className="mt-1 text-sm text-slate-600">or select a file from your device</span>
              {file && <span className="mt-2 text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>}
            </button>
            <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} />

            {error && <p className="mt-4 border-l-4 border-red-700 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">{error}</p>}

            {(uploading || progress > 0) && (
              <div className="mt-5">
                <div className="mb-1 flex justify-between text-sm"><span>{uploading ? "Uploading and processing" : "Upload complete"}</span><span>{progress}%</span></div>
                <progress className="h-2 w-full accent-emerald-800" max={100} value={progress} aria-label="Upload progress" />
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button type="button" onClick={uploadFile} disabled={!file || uploading} className="button-primary">
                {uploading ? "Processing..." : "Upload Form 700"}
              </button>
            </div>
          </section>

          {summary && (
            <section className="border border-emerald-300 bg-white p-5 sm:p-7" aria-live="polite">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-emerald-800">Ingestion complete</p>
              <h2 className="mt-1 text-lg font-semibold">Filing processed successfully</h2>
              <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div><dt className="text-xs uppercase text-slate-500">Filing ID</dt><dd className="mt-1 break-all font-mono text-sm">{summary.filing_id}</dd></div>
                <div><dt className="text-xs uppercase text-slate-500">Politician matched</dt><dd className="mt-1 font-medium">{summary.politician?.name ?? summary.politician_id}</dd>
                  {summary.politician?.slug && <a className="mt-1 inline-block text-sm font-medium text-emerald-800 underline" href={`/politicians/${encodeURIComponent(summary.politician.slug)}`}>View politician profile</a>}
                </div>
              </dl>
              <div className="mt-6 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold">Schedule records</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([["Schedule A", summary.schedules_parsed.A], ["Schedule B", summary.schedules_parsed.B], ["Schedules C/D/E", summary.schedules_parsed.CDE], ["Schedule A-2", summary.schedules_parsed.A2]] as const).map(([label, count]) => (
                    <div key={label} className="border-l-2 border-emerald-700 pl-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="text-xl font-semibold tabular-nums">{count}</dd></div>
                  ))}
                </dl>
              </div>
            </section>
          )}
        </main>
      </div>
    </AdminGuard>
  );
}