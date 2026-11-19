-- Supabase advisor 0013 (rls_disabled_in_public) / 0026 / 0027:
-- _prisma_migrations is readable through PostgREST and GraphQL with the public
-- anon key. Prisma connects as the database owner, which bypasses RLS, so
-- enabling RLS with no policies and revoking API roles does not affect
-- `prisma migrate deploy`.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._prisma_migrations FROM anon, authenticated;
