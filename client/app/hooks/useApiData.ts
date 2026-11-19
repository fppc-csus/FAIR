import { useEffect, useState } from "react";
import { investigatorFetch } from "../adminAuth";

/**
 * Load one investigator API resource (`{ data }` contract) with the signed-in
 * session. Missing records raise the route 404 boundary; outages stay retryable.
 */
export function useApiData<T>(url: string) {
  return useApiRequest<T>(url, "data");
}

/** Like useApiData, but returns the whole JSON body (e.g. `{ data, total }` or a bare array). */
export function useApiPayload<T>(url: string) {
  return useApiRequest<T>(url, "payload");
}

function useApiRequest<T>(url: string, mode: "data" | "payload") {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null); setNotFound(false);
    void investigatorFetch(url, { signal: controller.signal }).then(async response => {
      if (response.status === 404) { if (!controller.signal.aborted) setNotFound(true); return; }
      if (!response.ok) throw new Error(`These records are temporarily unavailable (HTTP ${response.status}). Please try again.`);
      let payload;
      try { payload = await response.json(); } catch { throw new Error("The server returned an unreadable response. Please try again."); }
      if (mode === "payload") { if (!controller.signal.aborted) setData(payload); return; }
      if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error(`The server returned an incomplete response for ${new URL(url, window.location.origin).pathname}. Please try again.`);
      if (payload.data == null) { if (!controller.signal.aborted) setNotFound(true); return; }
      if (!controller.signal.aborted) setData(payload.data);
    }).catch(reason => {
      if (!controller.signal.aborted && reason?.name !== "AbortError") setError(reason.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt, mode]);
  if (notFound) throw new Response(null, { status: 404, statusText: 'Not Found' });
  return { data, loading, error, retry: () => setAttempt(value => value + 1) };
}
