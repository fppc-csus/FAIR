/**
 * Express application (no listener). `index.js` imports this, schedules cron and
 * calls `app.listen`; tests can import `app` directly and drive it with supertest.
 */
import './lib/env.js';
import cors from 'cors';
import express from 'express';

import { requireAdmin } from './lib/auth.js';
import { prisma } from './lib/prisma.js';
import { requestTiming } from './middleware/requestTiming.js';
import agendaRouter from './routes/agenda.js';
import conflictsRouter from './routes/conflicts.js';
import politiciansRouter from './routes/politicians.js';
import searchRouter from './routes/search.js';
import adminReportsRouter from './routes/admin/reports.js';
import adminSourcesRouter from './routes/admin/sources.js';
import adminUploadRouter from './routes/admin/upload.js';
import adminPoliticiansRouter from './routes/admin/politicians.js';
import adminConflictsRouter from './routes/admin/conflicts.js';
import adminHistoryRouter from './routes/admin/history.js';

// AC4: manual nightly sync route
import adminSyncRouter from './routes/adminSync.js';

export const app = express();

// --- global middleware -----------------------------------------------------
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    exposedHeaders: ['X-Request-ID'],
  }),
);
app.use(express.json());
app.use(requestTiming);

// --- health ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', database: 'ok' });
  } catch (error) {
    console.error('[health] database readiness check failed:', error);
    res.status(503).json({ status: 'unavailable', database: 'error' });
  }
});

// --- public API ------------------------------------------------------------
app.use('/api/conflicts', conflictsRouter);
app.use('/api/politicians', politiciansRouter);
app.use('/api/agenda', agendaRouter);
app.use('/api/search', searchRouter);

// --- admin API (Supabase JWT required) --------------------------------------
app.get('/api/admin/session', requireAdmin, (req, res) => {
  res.status(200).json({ data: { userId: req.user.id, email: req.user.email } });
});
app.use('/api/admin/sources', requireAdmin, adminSourcesRouter);
app.use('/api/admin/reports', requireAdmin, adminReportsRouter);
app.use('/api/admin/politicians', requireAdmin, adminPoliticiansRouter);
app.use('/api/admin/conflicts', requireAdmin, adminConflictsRouter);
app.use('/api/admin/history', requireAdmin, adminHistoryRouter);

// AC4: manual nightly sync trigger
app.use('/api/admin/sync', requireAdmin, adminSyncRouter);

// multer (10 MB memory storage) is applied inside the upload router, not globally.
app.use('/api/admin/upload', requireAdmin, adminUploadRouter);

// --- 404 -------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// --- error handler ---------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : (err?.status ?? 500);
  const isProduction = process.env.NODE_ENV === 'production';

  if (statusCode >= 500 || !isProduction) {
    console.error('[server] unhandled error:', err);
  }

  const message =
    err?.publicMessage ?? (statusCode >= 500
      ? 'The server could not complete this request. Please try again.'
      : 'The request could not be processed. Check your input and try again.');

  const body = { error: message };

  res.status(statusCode).json(body);
});

export default app;
