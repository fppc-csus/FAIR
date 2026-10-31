import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import Dashboard from './conflicts';
afterEach(() => vi.restoreAllMocks());
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
it('restores URL filters, requests the next page, and resets page on filter changes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => Response.json(String(input).includes('/filters') ? { data: ['Davis'] } : { data: [], total: 45 }));
  render(<MemoryRouter initialEntries={['/conflicts?city=Davis&page=2&fromDate=2026-10-01']}><Dashboard /><Location /></MemoryRouter>);
  expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  expect(screen.getByLabelText('City')).toHaveValue('Davis');
  expect(screen.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toContain('fromDate=2026-10-01');
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'HIGH' } });
  await waitFor(() => expect(screen.getByLabelText('URL')).not.toHaveTextContent('page='));
  expect(fetch.mock.calls.some(([input]) => String(input).includes('severities=HIGH'))).toBe(true);
});
