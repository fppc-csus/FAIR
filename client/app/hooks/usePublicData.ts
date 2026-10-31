import { useEffect, useState } from "react";
import { request } from "../lib/request";

export function usePublicData<T>(url: string, missingMessage = "This record was not found.") {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    void request(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? missingMessage : `These records are temporarily unavailable (HTTP ${response.status}). Please try again.`);
      let payload;
      try { payload = await response.json(); } catch { throw new Error("The server returned an unreadable response. Please try again."); }
      if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error(`The server returned an incomplete response for ${new URL(url, window.location.origin).pathname}. Please try again.`);
      if (payload.data == null) throw new Error(missingMessage);
      if (!controller.signal.aborted) setData(payload.data);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, missingMessage, attempt]);
  return { data, loading, error, retry: () => setAttempt(value => value + 1) };
}