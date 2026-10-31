import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminGuard, AdminNav } from './adminComponents';

const auth = vi.hoisted(() => ({ session: vi.fn(), verify: vi.fn(), signOut: vi.fn() }));
vi.mock('./adminAuth', () => ({ getAdminSession: auth.session, verifyAdminAccess: auth.verify, signOut: auth.signOut }));
beforeEach(() => { vi.clearAllMocks(); auth.session.mockResolvedValue({}); auth.verify.mockResolvedValue(undefined); });

it('waits for backend authorization before displaying protected content', async () => {
  render(<MemoryRouter><AdminGuard><p>Protected history</p></AdminGuard></MemoryRouter>);
  expect(await screen.findByText('Protected history')).toBeVisible();
  expect(auth.verify).toHaveBeenCalled();
});
it('shows retry instead of protected content during verification outages', async () => {
  auth.verify.mockRejectedValue(new Error('Verification temporarily unavailable'));
  render(<MemoryRouter><AdminGuard><p>Protected history</p></AdminGuard></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Verification temporarily unavailable');
  expect(screen.queryByText('Protected history')).not.toBeInTheDocument();
});
it('links to the warnings and history page', () => {
  render(<MemoryRouter><AdminNav title="Admin" /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/admin/history');
});