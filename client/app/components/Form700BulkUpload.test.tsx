import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Form700BulkUpload from './Form700BulkUpload';
import { adminFetch } from '../adminAuth';

vi.mock('../adminAuth', () => ({ adminFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const preview = { digest: 'digest', warnings: ['Review amendments for completeness.'], filings: [{ filer_name: 'Alice One', agency: 'County Test', filing_year: 2019, filing_type: 'Annual', filed_at: '2020-04-01', status: 'ready', versions: [{}], schedules_parsed: { A: 2 } }] };

it('requires a preview and warning acknowledgement before importing', async () => {
  vi.mocked(adminFetch).mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(Response.json({ imported: 1, skipped: 0, failed: 0, results: [{ filer_name: 'Alice One', status: 'imported', slug: 'alice' }] }));
  render(<Form700BulkUpload />);
  expect(screen.getByRole('button', { name: 'Preview bulk workbook' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Bulk workbook (maximum 10 MB)'), { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  expect(await screen.findByText('Review amendments for completeness.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm bulk import' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk import' }));
  expect(await screen.findByText('1 imported · 0 skipped · 0 failed')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/politicians/alice');
  const init = vi.mocked(adminFetch).mock.calls[1][1]!;
  expect((init.body as FormData).get('digest')).toBe('digest');
});

it('rejects invalid files and displays backend failures', async () => {
  vi.mocked(adminFetch).mockResolvedValue(Response.json({ error: 'Invalid filer metadata.' }, { status: 400 }));
  render(<Form700BulkUpload />);
  const input = screen.getByLabelText('Bulk workbook (maximum 10 MB)');
  fireEvent.change(input, { target: { files: [new File(['pdf'], 'county.pdf')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('XLSX');
  fireEvent.change(input, { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid filer metadata.'));
  expect(screen.queryByRole('button', { name: 'Confirm bulk import' })).not.toBeInTheDocument();
});

it('invalidates preview when the selected file changes', async () => {
  vi.mocked(adminFetch).mockResolvedValue(Response.json(preview));
  render(<Form700BulkUpload />);
  const input = screen.getByLabelText('Bulk workbook (maximum 10 MB)');
  fireEvent.change(input, { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  await screen.findByRole('checkbox');
  fireEvent.change(input, { target: { files: [new File(['other'], 'other.xlsx')] } });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});