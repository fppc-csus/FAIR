import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { cutoffDate, DatasetError, extractLinks, meetingDate, parseInput, publicUrl, robotsAllowed, scrape, type Agenda } from '../src/scraper.js';

const archive = readFileSync(new URL('./fixtures/archive.html', import.meta.url), 'utf8');
const now = new Date('2026-10-15T19:00:00Z');
const input = parseInput({ startUrl: 'https://city.test/', cityName: 'City of Test' });
function fixtureFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url === input.startUrl) return new Response(archive, { headers: { 'content-type': 'text/html' } });
    if (url.endsWith('/broken.pdf')) return new Response('', { status: 500 });
    if (url.endsWith('/fake.pdf')) return new Response('not a PDF', { headers: { 'content-type': 'application/pdf' } });
    if (url.includes('/archive/page/')) return new Response('<h1>No more meetings</h1>', { headers: { 'content-type': 'text/html' } });
    return new Response('%PDF-1.7 fixture', { headers: { 'content-type': 'application/octet-stream' } });
  });
}

describe('input and helpers', () => {
  it('validates defaults, bounds and URLs', () => {
    expect(input.maxPages).toBe(200);
    for (const overrides of [{ maxPages: 0 }, { maxDepth: -1 }, { lookbackDays: 1.5 }, { sameDomainOnly: 'yes' }, { startUrl: 'file:///tmp/file' }, { cityName: '' }]) {
      expect(() => parseInput({ ...input, ...overrides })).toThrow();
    }
    expect(() => parseInput(null)).toThrow();
    expect(() => publicUrl('http://localhost/')).toThrow();
    expect(publicUrl('/agenda.pdf#page=2', input.startUrl).href).toBe('https://city.test/agenda.pdf');
  });
  it('extracts and validates dates without inventing them', () => {
    expect(meetingDate('October 8, 2026')).toBe('2026-10-08');
    expect(meetingDate('10/08/2026')).toBe('2026-10-08');
    expect(meetingDate('agenda-2026-10-08.pdf')).toBe('2026-10-08');
    expect(meetingDate('2026-02-30')).toBeNull();
    expect(meetingDate('2026-10-08 and 2026-10-09')).toBeNull();
    expect(meetingDate('Unknown')).toBeNull();
  });
  it('uses Pacific calendar dates, including DST boundaries', () => {
    expect(cutoffDate(new Date('2026-10-15T01:00:00Z'), 14)).toBe('2026-09-30');
    expect(cutoffDate(new Date('2026-03-09T01:00:00Z'), 1)).toBe('2026-03-07');
  });
  it('extracts relative links, row dates, and query parameters', () => {
    const links = extractLinks(archive, input.startUrl);
    expect(links.find((l) => l.url.includes('/download'))?.url).toBe('https://city.test/download?id=42&format=pdf');
    expect(links[0].context).toContain('October 1, 2026');
    expect(extractLinks('<script><a href="/bad">bad</a></script><a href="javascript:void(0)">bad</a>', input.startUrl)).toEqual([]);
  });
  it('honors conservative robots rules', () => {
    expect(robotsAllowed('User-agent: *\nDisallow: /private', 'https://city.test/private/a')).toBe(false);
    expect(robotsAllowed('Disallow: /*.pdf$', 'https://city.test/file.pdf')).toBe(false);
    expect(robotsAllowed('Disallow:\nDisallow: /private', input.startUrl)).toBe(true);
  });
});

describe('scrape', () => {
  it('emits the backend contract; deduplicates, filters and keeps future meetings', async () => {
    const output: Agenda[] = [];
    const fetcher = fixtureFetch();
    const summary = await scrape(input, fetcher, async (item) => { output.push(item); }, vi.fn(), now);
    expect(output.map((item) => item.meeting_date)).toEqual(['2026-10-01', '2026-10-08', '2026-11-03']);
    expect(output.every((item) => item.city_name === input.cityName)).toBe(true);
    expect(summary.records).toBe(3);
    expect(summary.errors).toBe(1);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/minutes.pdf'))).toBe(false);
  });
  it('respects depth and document request limits', async () => {
    expect((await scrape({ ...input, maxDepth: 0 }, fixtureFetch(), vi.fn(), vi.fn(), now)).records).toBe(0);
    const result = await scrape({ ...input, maxPages: 2 }, fixtureFetch(), vi.fn(), vi.fn(), now);
    expect(result.requests).toBe(2);
    expect(result.records).toBe(1);
    expect(result.remaining).toBeGreaterThan(0);
  });
  it('fails instead of reporting empty success when the start page fails', async () => {
    const fetcher = vi.fn(async (url: string) => new Response('', { status: url.endsWith('robots.txt') ? 404 : 403 }));
    await expect(scrape(input, fetcher, vi.fn(), vi.fn(), now)).rejects.toThrow('HTTP 403');
  });
  it('does not crawl external HTML or disallowed pages', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return new Response('Disallow: /private');
      return new Response('<a href="https://outside.test/meetings">Council meetings</a><a href="/private/agenda.pdf">Agenda</a>', { headers: { 'content-type': 'text/html' } });
    });
    await scrape(input, fetcher, vi.fn(), vi.fn(), now);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://city.test/robots.txt', input.startUrl]);
  });
  it('propagates storage failures', async () => {
    await expect(scrape(input, fixtureFetch(), async () => { throw new DatasetError('storage failed'); }, vi.fn(), now)).rejects.toThrow('storage failed');
  });
  it('skips conflicting row and filename dates', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url === input.startUrl) return new Response('<tr><td>October 8, 2026</td><td><a href="/agenda-2026-10-09.pdf">Agenda</a></td></tr>', { headers: { 'content-type': 'text/html' } });
      return new Response('%PDF-1.7');
    });
    const emit = vi.fn();
    await scrape(input, fetcher, emit, vi.fn(), now);
    expect(emit).not.toHaveBeenCalled();
  });
});