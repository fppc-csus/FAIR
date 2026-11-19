# React routes and UI (`client/app/`)

Start at `routes.ts`; it is the authoritative route manifest. Investigator routes (all signed-in) cover the dashboard (`home.tsx`), conflicts, politician dossiers, agenda items and methodology (`about.tsx`). Admin routes cover login, upload, identity review, sources, reports, history and users. Shared badges, labels and navigation live in `components/investigator.tsx`.

## Placement

- Route/page behavior: `routes/*.tsx`.
- Reusable visual pieces: `components/`.
- Reusable state/data logic: `hooks/`.
- Transport and external-service helpers: `lib/`.
- Global layout/styles: `root.tsx` and `app.css`.

Use functional TypeScript components and hooks. Keep tests next to the source when practical; seed a session with `test/session.ts` for data pages. Verify keyboard-visible behavior, loading/error states, and the signed-in boundary rather than implementation details.


Parent guide: `../CONTEXT.md`.
