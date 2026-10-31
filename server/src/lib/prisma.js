/**
 * Shared PrismaClient singleton.
 *
 * This is the ONLY place `new PrismaClient()` should be called on the server.
 * The instance is cached on `globalThis` so `node --watch` reloads (which
 * re-evaluate modules but keep the same process) reuse the existing connection
 * pool instead of leaking one per reload.
 */

import './env.js';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

const requestedLimit = Number(process.env.PRISMA_MAX_CONNECTIONS ?? 20);
const connectionLimit = Number.isFinite(requestedLimit)
  ? Math.max(1, Math.min(Math.floor(requestedLimit), 20))
  : 20;

const databaseUrl = process.env.DATABASE_URL;
const options = {
  log: process.env.NODE_ENV === 'production'
    ? ['error']
    : ['warn', 'error'],
};

if (databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(connectionLimit));

  options.datasources = {
    db: { url: url.toString() },
  };
}

export const prisma =
  globalForPrisma.__fairPrisma ?? new PrismaClient(options);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__fairPrisma = prisma;
}

export default prisma;
