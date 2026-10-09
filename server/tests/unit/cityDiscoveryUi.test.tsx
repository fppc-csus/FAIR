import React from '../../../client/node_modules/react/index.js';
import { renderToStaticMarkup } from '../../../client/node_modules/react-dom/server.node.js';
import { afterEach, expect, it, vi } from 'vitest';
import CityAgendaDiscovery from '../../../client/app/components/CityAgendaDiscovery';
vi.mock('../../../client/app/hooks/useCityDiscovery', () => ({ useCityDiscovery: vi.fn() }));
import { useCityDiscovery } from '../../../client/app/hooks/useCityDiscovery';
afterEach(() => vi.clearAllMocks());
it('renders city-only input and an optional URL fallback', () => {
  vi.mocked(useCityDiscovery).mockReturnValue({ busy: false, error: '', message: '', documents: [], discover: vi.fn() });
  const html = renderToStaticMarkup(React.createElement(CityAgendaDiscovery));
  expect(html).toContain('City name');
  expect(html).toContain('Official agenda URL (optional)');
  expect(html).toContain('Find and scrape agendas');
});
it('renders failure, status and safe document links', () => {
  vi.mocked(useCityDiscovery).mockReturnValue({ busy: true, error: 'Lookup failed', message: 'Searching', discover: vi.fn(), documents: [{ id: '1', title: 'Council Agenda', meetingDate: '2026-10-01', pdfUrl: 'https://city.gov/a.pdf' }] });
  const html = renderToStaticMarkup(React.createElement(CityAgendaDiscovery));
  expect(html).toContain('role="alert"');
  expect(html).toContain('role="status"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('Finding agendas');
});