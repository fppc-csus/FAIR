import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import Login from './admin.login';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), signIn: vi.fn(), verify: vi.fn() }));
vi.mock('../adminAuth', () => ({ getAdminSession: mocks.getSession, signInWithPassword: mocks.signIn, verifyAdminAccess: mocks.verify, isAdminAuthConfigured: () => true }));
afterEach(() => vi.clearAllMocks());

it('verifies backend authorization before completing login', async () => {
  mocks.getSession.mockRejectedValue(new Error('missing')); mocks.signIn.mockResolvedValue({}); mocks.verify.mockResolvedValue(undefined);
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.gov' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }));
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
  expect(mocks.signIn).toHaveBeenCalledWith('admin@example.gov', 'password');
});

it('shows a clear reason after an authorization redirect', () => {
  mocks.getSession.mockRejectedValue(new Error('missing'));
  render(<MemoryRouter initialEntries={['/admin/login?reason=forbidden']}><Login /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('not configured as the FAIR administrator');
});