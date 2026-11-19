import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useApiData } from './useApiData';
import { signInForTest } from '../test/session';
import { createMemoryRouter, RouterProvider, useRouteError } from 'react-router';
import { ErrorBoundary } from '../root';

beforeEach(() => signInForTest());
afterEach(() => vi.restoreAllMocks());
it('sends the investigator session with every data request', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }));
  const { result } = renderHook(() => useApiData('/api/politicians'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const [, init] = fetch.mock.calls[0];
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access');
  expect(String(fetch.mock.calls[0][0])).toMatch(/\/api\/politicians$/);
});
it('identifies the endpoint when an API response lacks the data contract', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'old deployment' }));
  const { result } = renderHook(() => useApiData('https://api.example.gov/api/conflicts/filters'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain('/api/conflicts/filters');
});

it.each([404, 200])('renders the 404 screen for missing records (HTTP %s)', async status => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: null }, { status }));
  function Page() { useApiData('https://api.example.gov/api/conflicts/id'); return <p>Loading</p>; }
  function Boundary() { return <ErrorBoundary error={useRouteError()} params={{}} />; }
  const router = createMemoryRouter([{ path: '/', Component: Page, ErrorBoundary: Boundary }]);
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
});
it('keeps server outages retryable rather than showing a 404', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}, { status: 503 }));
  const { result } = renderHook(() => useApiData('https://api.example.gov/api/conflicts/id'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain('503');
});