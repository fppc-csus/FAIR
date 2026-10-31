import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePublicData } from './usePublicData';

afterEach(() => vi.restoreAllMocks());
it('identifies the endpoint when an API response lacks the data contract', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'old deployment' }));
  const { result } = renderHook(() => usePublicData('https://api.example.gov/api/conflicts/filters'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain('/api/conflicts/filters');
});

it('preserves record-specific 404 messages', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'not found' }, { status: 404 }));
  const { result } = renderHook(() => usePublicData('https://api.example.gov/api/conflicts/id', 'Conflict not found.'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('Conflict not found.');
});