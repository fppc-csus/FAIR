import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import History from './admin.history';

vi.mock('../adminComponents', () => ({ AdminGuard: ({ children }: { children: React.ReactNode }) => children, AdminNav: () => null }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../adminAuth', () => ({ adminFetch: mocks.fetch }));
afterEach(() => vi.clearAllMocks());

it('renders recorded warnings and filer history', async () => {
  mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: 'run', filename: 'county.xlsx', createdAt: '2026-10-30T10:00:00Z', status: 'completed', imported: 1, skipped: 0, failed: 0, warnings: ['Review amendments.'], results: [{ filer_name: 'James Gore', filing_year: 2019, jurisdiction: 'County Test', status: 'imported', slug: 'james', schedules_parsed: { A: 3 } }] }], pagination: { page: 1, pageCount: 1, total: 1 } }));
  render(<History />);
  expect(await screen.findByText('Review amendments.')).toBeVisible();
  fireEvent.click(screen.getByText(/View 1 filer result/));
  expect(screen.getByRole('link', { name: 'James Gore' })).toHaveAttribute('href', '/politicians/james');
  expect(screen.getByText('A: 3')).toBeVisible();
});

it('sends warning and search filters and supports retry', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValue(Response.json({ data: [], pagination: { page: 1, pageCount: 1, total: 0 } }));
  render(<History />);
  expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText('No import history matches these filters')).toBeVisible());
  fireEvent.change(screen.getByLabelText('Search filename or filer'), { target: { value: 'Sonoma' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(screen.getByLabelText('Warnings or failures only'));
  await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith('/api/admin/history?page=1&search=Sonoma&warningOnly=true'));
  fireEvent.change(screen.getByLabelText('Filing year'), { target: { value: '2019' } });
  fireEvent.change(screen.getByLabelText('Import status'), { target: { value: 'partial' } });
  await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith('/api/admin/history?page=1&search=Sonoma&warningOnly=true&year=2019&status=partial'));
});