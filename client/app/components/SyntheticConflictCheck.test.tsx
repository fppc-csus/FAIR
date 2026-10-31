import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SyntheticConflictCheck from './SyntheticConflictCheck';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../adminAuth', () => ({ adminFetch: mocks.fetch }));
afterEach(() => vi.clearAllMocks());

it('runs and removes the fictional fixture through authenticated admin requests', async () => {
  mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => Response.json(
    init.method === 'POST' ? { exists: true, passed: true, conflictIds: ['demo-conflict'] }
      : init.method === 'DELETE' ? { removed: true } : { exists: false, passed: false },
  ));
  render(<SyntheticConflictCheck />);
  expect(await screen.findByText('No synthetic fixture installed.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run fictional conflict check' }));
  expect(await screen.findByText(/Passed: matching conflict stored/)).toBeInTheDocument();
  expect(screen.getByText(/Stored conflict ID: demo-conflict/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove fictional test data' }));
  expect(await screen.findByText('No synthetic fixture installed.')).toBeInTheDocument();
});

it('shows a failed request without claiming a successful check', async () => {
  mocks.fetch.mockResolvedValue(Response.json({ error: 'Database unavailable' }, { status: 500 }));
  render(<SyntheticConflictCheck />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
  expect(screen.queryByText(/Passed: matching conflict stored/)).not.toBeInTheDocument();
});