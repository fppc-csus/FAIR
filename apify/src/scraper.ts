export interface Input {
  startUrl: string;
  cityName: string;
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  lookbackDays: number;
}

export interface Agenda {
  pdf_url: string;
  meeting_date: string;
  city_name: string;
  source_page_url: string;
  document_title: string;
}

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') throw new Error('Input must be an object');
  const input = value as Record<string, unknown>;
  if (typeof input.startUrl !== 'string' || typeof input.cityName !== 'string' || !input.cityName.trim()) {
    throw new Error('startUrl and cityName are required');
  }
  publicUrl(input.startUrl);
  const number = (key: string, fallback: number, min: number, max: number) => {
    const n = input[key] ?? fallback;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  if (input.sameDomainOnly !== undefined && typeof input.sameDomainOnly !== 'boolean') throw new Error('Invalid sameDomainOnly');
  return {
    startUrl: input.startUrl, cityName: input.cityName,
    maxDepth: number('maxDepth', 2, 0, 10), maxPages: number('maxPages', 200, 1, 2000),
    lookbackDays: number('lookbackDays', 14, 0, 3650), sameDomainOnly: input.sameDomainOnly ?? true,
  };
}

export function publicUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Invalid public URL');
  url.hash = '';
  return url;
}

function text(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const names: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (entity.startsWith('&#')) {
      const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return names[entity.toLowerCase()] ?? entity;
  }).replace(/\s+/g, ' ').trim();
}

export function meetingDate(value: string): string | null {
  const dates = new Set<string>();
  const add = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      dates.add(date.toISOString().slice(0, 10));
    }
  };
  for (const m of value.matchAll(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/g)) add(+m[1], +m[2], +m[3]);
  // California city archives use US month/day/year dates.
  for (const m of value.matchAll(/\b(\d{1,2})[-_/](\d{1,2})[-_/](20\d{2})\b/g)) add(+m[3], +m[1], +m[2]);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (const m of value.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi)) {
    add(+m[3], months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  }
  return dates.size === 1 ? [...dates][0] : null;
}

export function cutoffDate(now: Date, days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function extractLinks(html: string, base: string) {
  const clean = html.replace(/<!--[^]*?-->|<script\b[^]*?<\/script>|<style\b[^]*?<\/style>/gi, '');
  const rows = [...clean.matchAll(/<(tr|li)\b[^>]*>([^]*?)<\/\1>/gi)];
  return [...clean.matchAll(/<a\b([^>]*?)>([^]*?)<\/a>/gi)].flatMap((match) => {
    const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) return [];
    try {
      const url = publicUrl(text(href[1] ?? href[2] ?? href[3]), base).href;
      const label = text(match[2]);
      const row = rows.find((r) => match.index! >= r.index! && match.index! < r.index! + r[0].length);
      return [{ url, label, context: row ? text(row[2]) : label }];
    } catch { return []; }
  });
}

// Conservative policy: honor disallows from every user-agent group. This can
// skip more than required, but will not override a site's restrictive group.
export function robotsAllowed(robots: string, url: string): boolean {
  const target = new URL(url);
  return !robots.split(/\r?\n/).some((line) => {
    const rule = line.split('#')[0].match(/^\s*disallow\s*:\s*(\S+)/i)?.[1];
    if (!rule) return false;
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    return new RegExp(`^${pattern}`).test(target.pathname + target.search);
  });
}

type Fetcher = (url: string) => Promise<Response>;
interface Candidate { url: string; depth: number; label: string; context: string; source: string; date: string | null; agenda: boolean }

export async function scrape(input: Input, fetchPage: Fetcher, emit: (item: Agenda) => Promise<void>, log = console.log, now = new Date()) {
  const originHost = new URL(input.startUrl).hostname;
  const queue: Candidate[] = [{ url: input.startUrl, depth: 0, label: '', context: '', source: input.startUrl, date: null, agenda: false }];
  const visited = new Set<string>();
  const emitted = new Set<string>();
  const robots = new Map<string, string>();
  const cutoff = cutoffDate(now, input.lookbackDays);
  let requests = 0;
  let errors = 0;
  while (queue.length && requests < input.maxPages) {
    const candidate = queue.shift()!;
    if (visited.has(candidate.url)) continue;
    visited.add(candidate.url);
    try {
      const origin = new URL(candidate.url).origin;
      if (!robots.has(origin)) {
        const response = await fetchPage(`${origin}/robots.txt`);
        if (!response.ok && response.status !== 404) throw new Error(`robots.txt unavailable (${response.status})`);
        robots.set(origin, response.status === 404 ? '' : await response.text());
      }
      if (!robotsAllowed(robots.get(origin)!, candidate.url)) throw new Error('Blocked by robots.txt');
      requests++;
      const response = await fetchPage(candidate.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const finalUrl = response.url || candidate.url;
      const pdf = bytes.subarray(0, 5).toString() === '%PDF-';
      if (pdf) {
        const filenameDate = meetingDate(decodeURI(new URL(finalUrl).pathname));
        if (filenameDate && candidate.date && filenameDate !== candidate.date) {
          log(`Skipping conflicting meeting dates: ${finalUrl}`);
          continue;
        }
        const date = meetingDate(`${candidate.context} ${decodeURI(new URL(finalUrl).pathname)}`) ?? candidate.date;
        if (!candidate.agenda || /\b(minutes|attachment|staff report)\b/i.test(candidate.label)) continue;
        if (!date) { log(`Skipping missing or ambiguous meeting date: ${finalUrl}`); continue; }
        if (date < cutoff) continue;
        const key = `${date}|${finalUrl}`;
        if (!emitted.has(key)) {
          await emit({ pdf_url: finalUrl, meeting_date: date, city_name: input.cityName, source_page_url: candidate.source, document_title: candidate.label });
          emitted.add(key);
        }
        continue;
      }
      if (input.sameDomainOnly && new URL(finalUrl).hostname !== originHost) continue;
      if (!response.headers.get('content-type')?.includes('text/html')) continue;
      if (candidate.depth >= input.maxDepth) continue;
      const html = bytes.toString('utf8');
      const headings = [...html.matchAll(/<(?:h1|h2)\b[^>]*>([^]*?)<\/(?:h1|h2)>/gi)].map((m) => text(m[1])).join(' ');
      const parentDate = candidate.date ?? meetingDate(headings);
      for (const link of extractLinks(html, finalUrl)) {
        const hint = `${link.label} ${link.url}`;
        if (/\b(minutes|video|attachment)\b/i.test(link.label)) continue;
        const document = /\.pdf(?:\?|$)|download|document|viewfile|showdocument/i.test(link.url);
        const relevant = /agenda|council|meeting|archive|government|city.clerk|next|older|previous|\bpage\b/i.test(`${hint} ${link.context}`);
        if (!relevant && !document) continue;
        if (input.sameDomainOnly && new URL(link.url).hostname !== originHost && !document) continue;
        queue.push({ ...link, depth: candidate.depth + 1, source: finalUrl,
          date: meetingDate(link.context) ?? parentDate,
          agenda: /agenda|packet/i.test(link.label) || (candidate.agenda && document && !link.label) || /agenda/i.test(new URL(link.url).pathname),
        });
      }
    } catch (error) {
      // Dataset failures must fail the run rather than masquerade as crawl skips.
      if (error instanceof DatasetError) throw error;
      errors++;
      log(`Skipped ${candidate.url}: ${error instanceof Error ? error.message : String(error)}`);
      if (candidate.depth === 0) throw error;
    }
  }
  return { requests, records: emitted.size, errors, remaining: queue.length };
}

export class DatasetError extends Error {}