import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import App, { ErrorBoundary } from "./root";
import { MemoryRouter, Routes, Route } from 'react-router';

it("provides a focusable main landmark for the skip link", () => {
  render(<MemoryRouter><Routes><Route element={<App />}><Route index element={<p>Page content</p>} /></Route></Routes></MemoryRouter>);
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
});

it("never renders exception messages or stacks", () => {
  const error = new Error("Secret database details");
  error.stack = "Error at /private/server.ts:42";
  render(<ErrorBoundary error={error} params={{}} />);
  expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("Secret");
  expect(document.body).not.toHaveTextContent("/private");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
it('shows the dedicated 404 page without a retry action', () => {
  render(<ErrorBoundary error={{ status: 404, statusText: 'Not Found', data: null, internal: false }} params={{}} />);
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
it.each([401, 403])('redirects route authorization errors (%s) to admin login', async status => {
  render(<MemoryRouter initialEntries={['/admin/history']}><Routes>
    <Route path="/admin/history" element={<ErrorBoundary error={{ status, statusText: 'Denied', data: null, internal: false }} params={{}} />} />
    <Route path="/admin/login" element={<h1>Admin sign in</h1>} />
  </Routes></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeVisible();
});
