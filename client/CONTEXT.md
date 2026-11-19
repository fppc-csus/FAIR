# Frontend workspace (`client/`)

## Role and entry points

React Router 7 application for authenticated FPPC investigators. There is no public access.

- `app/routes.ts`: URL-to-module manifest.
- `app/root.tsx`: document shell, header/footer, global error boundary.
- `app/routes/`: route modules; route filenames are not automatically active unless listed in `routes.ts`.
- `app/components/`: shared UI.
- `app/hooks/` and `app/lib/`: requests, loading state, Supabase/auth helpers.
- `app/adminAuth.ts` and `app/adminComponents.tsx`: admin session and route guard behavior.

## API and auth boundary

- All data comes from the Express API using `VITE_API_URL` (default `http://localhost:3001`) through `investigatorFetch`/`useApiData`, which attach the session token.
- Supabase browser auth uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Never expose database URLs or `SUPABASE_SECRET_KEY` to the client.
- `root.tsx` wraps every non-admin route in `AdminGuard`; only `/admin/login` and `/admin/account` render without a session. Admin routes guard themselves. Do not add public registration.

## Tests and commands

Tests are generally colocated as `*.test.ts(x)` and use Vitest + React Testing Library. One hook test currently lives at `server/tests/unit/useCityDiscovery.test.ts`.

```bash
cd client
npm test
npm run typecheck
npm run build
```

Read `app/CONTEXT.md` for route/UI changes and `server/CONTEXT.md` when changing an API shape.
