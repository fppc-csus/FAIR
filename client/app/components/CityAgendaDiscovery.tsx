import { useState, type FormEvent } from "react";
import { useCityDiscovery } from "../hooks/useCityDiscovery";

export default function CityAgendaDiscovery() {
  const [city, setCity] = useState("");
  const [url, setUrl] = useState("");
  const { busy, message, error, documents, discover } = useCityDiscovery();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (city.trim() && !busy) void discover(city.trim(), url);
  }
  return (
    <section className="surface mb-6 p-6" aria-labelledby="discover-heading">
      <h2 id="discover-heading" className="text-xl font-semibold">Find city council agendas</h2>
      <p className="mt-2 text-sm text-gray-600">Enter a California city. Apify will look up its official .gov website and search for agenda PDFs. Add cities one at a time. Runs use your configured Apify account.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="discover-city" className="block text-sm font-medium">City name</label>
          <input id="discover-city" value={city} onChange={(event) => setCity(event.target.value)} required maxLength={100} disabled={busy} placeholder="Elk Grove" className="field mt-1" />
        </div>
        <div>
          <label htmlFor="discover-url" className="block text-sm font-medium">Official agenda URL (optional)</label>
          <input id="discover-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} placeholder="https://…" className="field mt-1" />
          <p className="mt-1 text-xs text-gray-600">Use this if automatic lookup cannot uniquely identify the city or its agenda archive.</p>
        </div>
        <button disabled={busy || !city.trim()} className="button-primary">{busy ? "Finding agendas…" : "Find and scrape agendas"}</button>
      </form>
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {documents.length > 0 && <ul className="mt-4 space-y-2">{documents.map((document) => (
        <li key={document.id}><a href={document.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline">{document.meetingDate?.slice(0, 10)} — {document.title || "Agenda PDF"}</a></li>
      ))}</ul>}
    </section>
  );
}