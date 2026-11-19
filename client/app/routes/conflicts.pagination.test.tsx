import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signInForTest } from '../test/session';
import Dashboard from './conflicts';
beforeEach(() => signInForTest());
afterEach(() => vi.restoreAllMocks());
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
it('restores URL filters, requests the next page, and resets page on filter changes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => Response.json(String(input).includes('/filters') ? { data: ['Davis'] } : { data: [], total: 45 }));
  render(<MemoryRouter initialEntries={['/conflicts?city=Davis&page=2&fromDate=2026-10-01']}><Dashboard /><Location /></MemoryRouter>);
  expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  expect(screen.getByLabelText('City')).toHaveValue('Davis');
  expect(fetch.mock.calls.some(([input]) => String(input).includes('fromDate=2026-10-01'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'HIGH' } });
  await waitFor(() => expect(screen.getByLabelText('URL')).not.toHaveTextContent('page='));
  expect(fetch.mock.calls.some(([input]) => String(input).includes('severities=HIGH'))).toBe(true);
});
