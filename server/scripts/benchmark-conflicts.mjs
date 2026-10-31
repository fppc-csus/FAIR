// Read-only EXPLAIN ANALYZE on the configured database. Never prints credentials.
import '../src/lib/env.js';
import { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma.js';
import { parseConflictQuery, conflictSql } from '../src/utils/conflictQuery.js';
const filters = parseConflictQuery(Object.fromEntries(new URLSearchParams(process.argv[2] ?? '')));
const { from, order } = conflictSql(filters);
try {
  const size = await prisma.conflict.count();
  console.log(JSON.stringify({ datasetRows: size, page: filters.page, pageSize: filters.pageSize }));
  for (const [label, statement] of [
    ['count', Prisma.sql`SELECT COUNT(*)::int ${from}`],
    ['page', Prisma.sql`SELECT c.id ${from} ORDER BY ${order} LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`],
  ]) {
    const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
    console.log(JSON.stringify({ label, plan: explained }, null, 2));
  }
} finally { await prisma.$disconnect(); }
