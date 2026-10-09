import { useEffect, useRef, useState } from "react";
import { adminFetch } from "../adminAuth";

export type AgendaDocument = { id: string; title: string; pdfUrl: string; meetingDate: string | null };

export function useCityDiscovery() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState<AgendaDocument[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function discover(cityName: string, startUrl: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError(""); setDocuments([]);
    setMessage("Finding the official city website and scraping council agendas…");
    try {
      const response = await adminFetch("/api/admin/sources/discover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName, startUrl: startUrl.trim() }), signal: current.signal,
      });
      const run = await response.json();
      if (!response.ok) throw new Error(run.error ?? "Could not start discovery.");
      for (let attempt = 0; attempt < 240; attempt++) {
        if (current.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusResponse = await adminFetch(`/api/admin/sources/${run.sourceId}/sync/${run.syncLogId}`, { signal: current.signal });
        const status = await statusResponse.json();
        if (!statusResponse.ok || status.status === "failed") throw new Error(status.error ?? "Agenda discovery failed.");
        if (status.status === "success") {
          const result = await adminFetch(`/api/admin/sources/${run.sourceId}/documents`, { signal: current.signal });
          if (!result.ok) throw new Error("Scrape completed, but documents could not be loaded.");
          setDocuments(await result.json());
          setMessage(status.itemsFound ? `Found ${status.itemsFound} agenda files; saved ${status.itemsInserted} new files.` : "No dated agenda PDFs found in the last 14 days or upcoming meetings. Try the official agenda archive URL.");
          return;
        }
      }
      setMessage("Still running. Check this city's status in the source list; do not start a duplicate run.");
    } catch (failure) {
      if (!current.signal.aborted) { setError(failure instanceof Error ? failure.message : "Discovery failed."); setMessage(""); }
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return { busy, message, error, documents, discover };
}