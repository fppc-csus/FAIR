import { parseInput, type Input } from './scraper.js';

export const REGISTRY_URL = 'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else field += char;
  }
  if (quoted) throw new Error('Invalid city registry CSV');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export function findCityWebsite(csv: string, cityName: string): string {
  const normalize = (name: string) => name.trim().toLowerCase().replace(/^(?:city|town) of\s+/, '').replace(/,?\s+(?:california|ca)$/, '').trim();
  const city = normalize(cityName);
  if (!city) throw new Error('Enter a California city name.');
  const [headers, ...rows] = parseCsv(csv);
  const columns = ['Domain name', 'Domain type', 'Organization name', 'City', 'State'].map((name) => headers?.indexOf(name) ?? -1);
  if (columns.includes(-1)) throw new Error('City registry format changed. Supply an agenda URL.');
  const [domain, type, organization, place, state] = columns;
  const domains = new Set(rows.filter((row) => row[state] === 'CA' && row[type] === 'City' &&
    normalize(row[place] ?? '') === city && normalize(row[organization] ?? '') === city &&
    /^[a-z0-9-]+\.gov$/i.test(row[domain] ?? '')).map((row) => row[domain].toLowerCase()));
  if (domains.size !== 1) throw new Error(`No unique official .gov website found for ${cityName}, California. Supply the official council agenda URL and retry.`);
  return `https://${[...domains][0]}/`;
}

export async function resolveInput(value: unknown, fetcher: (url: string) => Promise<Response>): Promise<Input> {
  if (!value || typeof value !== 'object') return parseInput(value);
  const raw = value as Record<string, unknown>;
  if (raw.startUrl) return parseInput(raw);
  // Validate before spending requests on discovery.
  const validated = parseInput({ ...raw, startUrl: 'https://get.gov/', maxDepth: raw.maxDepth ?? 4 });
  const response = await fetcher(REGISTRY_URL);
  if (!response.ok) throw new Error(`City registry unavailable (${response.status}). Supply an agenda URL or retry.`);
  return { ...validated, startUrl: findCityWebsite(await response.text(), validated.cityName) };
}