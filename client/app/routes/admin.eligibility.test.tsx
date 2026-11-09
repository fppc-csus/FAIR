import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import AdminEligibilityPage from './admin.eligibility';

vi.mock('../adminComponents', () => ({ AdminGuard: ({ children }: { children: React.ReactNode }) => children, AdminNav: () => null }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../adminAuth', () => ({ adminFetch: mocks.fetch }));
afterEach(() => vi.clearAllMocks());
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const queue = { jurisdictions: [{ id: ID, name: 'Oakland', type: 'city' }], politicians: [], filings: [{ id: ID, filerName: 'Pat', originalFilename: 'pat.xlsx', filingYear: 2025, reason: 'UNVERIFIED_FILING_YEAR' }], agendaItems: [] };

it('shows reviewed source and sends the exact old value with a correction', async () => {
  mocks.fetch.mockImplementation(async (_path: string, init?: RequestInit) => Response.json(init?.method ? { data: { corrected: true } } : { data: queue }));
  const user = userEvent.setup(); render(<AdminEligibilityPage />);
  expect(await screen.findByText(/pat\.xlsx/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('Correct filing year'), '2024');
  await user.click(screen.getByRole('button', { name: 'Save correction' }));
  expect(mocks.fetch).toHaveBeenCalledWith(`/api/admin/eligibility/filing/${ID}/correct`, expect.objectContaining({
    body: JSON.stringify({ expectedValue: 2025, correctedValue: 2024 }),
  }));
  expect(await screen.findByRole('status')).toHaveTextContent('Correction saved');
});

it('sends the observed value for confirmation, and surfaces stale-value errors', async () => {
  mocks.fetch.mockImplementation(async (_path: string, init?: RequestInit) => init?.method
    ? Response.json({ error: 'STALE_VALUE' }, { status: 409 }) : Response.json({ data: queue }));
  const user = userEvent.setup(); render(<AdminEligibilityPage />);
  await user.click(await screen.findByRole('button', { name: 'Confirm reviewed value' }));
  expect(mocks.fetch).toHaveBeenCalledWith(`/api/admin/eligibility/filing/${ID}/verify`, expect.objectContaining({ body: JSON.stringify({ expectedValue: 2025 }) }));
  expect(await screen.findByText(/value changed since you loaded it/i)).toBeInTheDocument();
});