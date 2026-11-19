import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Form700BulkUpload from './Form700BulkUpload';
import { adminFetch } from '../adminAuth';

vi.mock('../adminAuth', () => ({ adminFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const preview = { digest: 'digest', warnings: ['Review amendments for completeness.'], filings: [{ filer_name: 'Alice One', agency: 'County Test', filing_year: 2019, filing_type: 'Annual', filed_at: '2020-04-01', status: 'ready', versions: [{}], schedules_parsed: { A: 2 } }] };

it('offers a prominent file-picker button and displays the chosen workbook', () => {
  render(<Form700BulkUpload />);
  const input = screen.getByLabelText('Bulk workbook (maximum 10 MB)');
  const click = vi.spyOn(input, 'click');
  const choose = screen.getByRole('button', { name: 'Choose bulk XLSX workbook' });
  expect(choose).toBeVisible();
  expect(choose).toHaveClass('button-primary', 'min-h-12', 'w-full');
  expect(choose).toHaveAccessibleDescription(/One .xlsx workbook/);
  fireEvent.click(choose);
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { files: [new File(['xlsx'], 'county-export.xlsx')] } });
  expect(screen.getByText(/county-export.xlsx ·/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Change bulk XLSX workbook' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Preview bulk workbook' })).toBeEnabled();
});

it('requires a preview and warning acknowledgement before importing', async () => {
  vi.mocked(adminFetch).mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(Response.json({ imported: 1, skipped: 0, failed: 0, results: [{ filer_name: 'Alice One', status: 'imported', slug: 'alice' }] }));
  render(<Form700BulkUpload />);
  expect(screen.getByRole('button', { name: 'Preview bulk workbook' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Bulk workbook (maximum 10 MB)'), { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  expect(await screen.findByText('Review amendments for completeness.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm bulk import' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Confirm bulk import' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk import' }));
  expect(await screen.findByText('1 imported · 0 replaced · 0 skipped · 0 failed')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/politicians/alice');
  const init = vi.mocked(adminFetch).mock.calls[1][1]!;
  expect((init.body as FormData).get('digest')).toBe('digest');
});

it.each([true, false])('explains eligibility when all-skipped is %s', async allSkipped => {
  const filings = [{ ...preview.filings[0], status: 'skipped' }, ...(allSkipped ? [] : [preview.filings[0]])];
  vi.mocked(adminFetch).mockResolvedValue(Response.json({ ...preview, filings }));
  render(<Form700BulkUpload />);
  fireEvent.change(screen.getByLabelText('Bulk workbook (maximum 10 MB)'), { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  await screen.findByRole('status');
  if (allSkipped) {
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to import');
    expect(screen.queryByRole('checkbox', { name: /I reviewed/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm bulk import' })).toBeDisabled();
  } else {
    expect(screen.getByRole('status')).toHaveTextContent('1 filing(s) ready');
    expect(screen.getByText(/Check the review acknowledgement/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ }));
    expect(screen.getByRole('button', { name: 'Confirm bulk import' })).toBeEnabled();
  }
});

it('can replace existing filings after an explicit opt-in and sends that choice', async () => {
  vi.mocked(adminFetch).mockResolvedValueOnce(Response.json({ ...preview, filings: [{ ...preview.filings[0], status: 'skipped' }] }))
    .mockResolvedValueOnce(Response.json({ imported: 0, replaced: 1, skipped: 0, failed: 0, results: [{ filer_name: 'Alice One', status: 'replaced' }] }));
  render(<Form700BulkUpload />);
  fireEvent.change(screen.getByLabelText('Bulk workbook (maximum 10 MB)'), { target: { files: [new File(['xlsx'], 'county.xlsx')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview bulk workbook' }));
  expect(await screen.findByText('Existing filing — skip')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: /Replace 1 existing filing/ }));
  expect(screen.getByText('Existing filing — replace')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk import' }));
  expect(await screen.findByText('0 imported · 1 replaced · 0 skipped · 0 failed')).toBeVisible();
  expect((vi.mocked(adminFetch).mock.calls[1][1]!.body as FormData).get('replace_existing')).toBe('true');
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