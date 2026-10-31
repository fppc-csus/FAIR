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
import adminDetectionRunsRouter from './routes/admin/detectionRuns.js';
import adminConflictsRouter from './routes/admin/conflicts.js';
import adminHistoryRouter from './routes/admin/history.js';

// AC4: manual nightly sync route
import adminSyncRouter from './routes/adminSync.js';

export const app = express();

// --- global middleware -----------------------------------------------------
app.use(
  cors({
    origin:
      process.env.CLIENT_ORIGIN ||
      (process.env.NODE_ENV === 'production'
        ? false
        : 'http://localhost:5173'),
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
app.use('/api/admin/detection-runs', requireAdmin, adminDetectionRunsRouter);
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
app.use((err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const candidate = err?.statusCode ?? err?.status;
  let statusCode =
    Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
      ? candidate
      : 500;

  if (err?.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
  }

  if (statusCode >= 500) {
    console.error('[server] unhandled error:', err);
  }

  let message;

  if (statusCode >= 500) {
    message = 'The server could not complete this request. Please try again.';
  } else if (statusCode === 413) {
    message = 'The uploaded file or request body is too large.';
  } else if (err?.type === 'entity.parse.failed') {
    message = 'The request body contains invalid JSON.';
  } else {
    message =
      err?.publicMessage ??
      'The request could not be processed. Check your input and try again.';
  }

  return res.status(statusCode).json({ error: message });
});

export default app;
