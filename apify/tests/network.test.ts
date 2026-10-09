import { afterEach, expect, it, vi } from 'vitest';
import { fetchDocument, isPublicAddress } from '../src/network.js';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('rejects private and mapped addresses', () => {
  for (const address of ['127.0.0.1', '10.1.1.1', '172.16.1.1', '192.168.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress('93.184.216.34')).toBe(true);
});
it('fetches a bounded response with redirects disabled', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response('hello'));
  vi.stubGlobal('fetch', fetcher);
  const pending = fetchDocument('https://city.test/');
  await vi.runAllTimersAsync();
  expect(await (await pending).text()).toBe('hello');
  expect(fetcher.mock.calls[0]).toBeDefined();
});
it.each([
  () => new Response(null, { status: 302, headers: { location: 'http://localhost/' } }),
  () => new Response('large', { headers: { 'content-length': '20971521' } }),
  () => new Response('', { status: 503 }),
])('fails after bounded retries for unsafe or unavailable responses', async (response) => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetcher);
  const assertion = expect(fetchDocument('https://city.test/')).rejects.toThrow();
  await vi.runAllTimersAsync();
  await assertion;
  expect(fetcher).toHaveBeenCalledTimes(3);
});