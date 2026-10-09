import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ setters: [] as Array<ReturnType<typeof vi.fn>>, fetch: vi.fn() }));
vi.mock('../../../client/node_modules/react/index.js', () => ({
  useState: (initial: unknown) => { const setter = vi.fn(); mocks.setters.push(setter); return [initial, setter]; },
  useRef: () => ({ current: null }), useEffect: vi.fn(),
}));
vi.mock('../../../client/app/adminAuth', () => ({ adminFetch: mocks.fetch }));
import { useCityDiscovery } from '../../../client/app/hooks/useCityDiscovery';
afterEach(() => { vi.clearAllMocks(); mocks.setters.length = 0; vi.useRealTimers(); });
it('submits a city, polls its run and loads discovered documents', async () => {
  vi.useFakeTimers();
  const documents = [{ id: 'pdf', pdfUrl: 'https://city.gov/a.pdf' }];
  mocks.fetch.mockResolvedValueOnce(Response.json({ sourceId: 's', syncLogId: 'r' }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ status: 'success', itemsFound: 1, itemsInserted: 1 }))
    .mockResolvedValueOnce(Response.json(documents));
  const pending = useCityDiscovery().discover('Example', '');
  await vi.runAllTimersAsync();
  await pending;
  expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/sources/discover', expect.objectContaining({ body: JSON.stringify({ cityName: 'Example', startUrl: '' }) }));
  expect(mocks.setters[3]).toHaveBeenCalledWith(documents);
  expect(mocks.setters[0]).toHaveBeenLastCalledWith(false);
});
it('shows API errors and clears the busy state', async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'Not configured' }, { status: 400 }));
  await useCityDiscovery().discover('Example', '');
  expect(mocks.setters[2]).toHaveBeenCalledWith('Not configured');
  expect(mocks.setters[0]).toHaveBeenLastCalledWith(false);
});