import { expect, it, vi } from 'vitest';
import { findCityWebsite, parseCsv, resolveInput } from '../src/discovery.js';
const csv = 'Domain name,Domain type,Organization name,City,State\nexample.gov,City,City of Example,Example,CA\nother.gov,City,City of Example,Example,TX\n';
it('resolves only an exact California city government', () => {
  expect(findCityWebsite(csv, 'City of Example, CA')).toBe('https://example.gov/');
  expect(() => findCityWebsite(csv, 'Missing')).toThrow('No unique');
  expect(() => findCityWebsite(csv + 'another.gov,City,City of Example,Example,CA', 'Example')).toThrow('No unique');
  expect(() => findCityWebsite('bad,headers', 'Example')).toThrow('format');
});
it('handles quoted CSV fields and rejects malformed input', () => {
  expect(parseCsv('"a,b","a""b"\r\n')).toEqual([['a,b', 'a"b']]);
  expect(() => parseCsv('"unfinished')).toThrow();
});
it('discovers a URL with bounded defaults and preserves explicit URLs', async () => {
  const fetcher = vi.fn(async () => new Response(csv));
  expect(await resolveInput({ cityName: 'Example' }, fetcher)).toMatchObject({ startUrl: 'https://example.gov/', maxDepth: 4 });
  fetcher.mockClear();
  expect(await resolveInput({ cityName: 'Example', startUrl: 'https://example.gov/agendas' }, fetcher)).toMatchObject({ startUrl: 'https://example.gov/agendas' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(resolveInput({ cityName: '' }, fetcher)).rejects.toThrow();
  await expect(resolveInput({ cityName: 'Example' }, async () => new Response('', { status: 503 }))).rejects.toThrow('unavailable');
});