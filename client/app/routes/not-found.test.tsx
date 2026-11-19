import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useRouteError } from 'react-router';
import { expect, it } from 'vitest';
import NotFoundRoute, { clientLoader } from './not-found';
import { ErrorBoundary } from '../root';

it.each(['/missing', '/admin/unknown', '/404'])('handles unknown URL %s with a 404 response and page', async path => {
  function Boundary() { return <ErrorBoundary error={useRouteError()} params={{}} />; }
  const router = createMemoryRouter([{ path: '*', loader: clientLoader, Component: NotFoundRoute, HydrateFallback: () => null, ErrorBoundary: Boundary }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(router.state.errors).toMatchObject({ '0': { status: 404 } });
});