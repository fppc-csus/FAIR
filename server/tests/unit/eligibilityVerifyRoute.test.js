import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verification = vi.hoisted(() => vi.fn());
vi.mock('../../src/detection/verifyEligibility.js', () => ({ verifyEligibilityMetadata: verification }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: {} }));
import router from '../../src/routes/admin/eligibility.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const app = express();
app.use(express.json());
app.use('/api/admin/eligibility', router);
const authenticated = express();
authenticated.use(express.json());
authenticated.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
authenticated.use('/api/admin/eligibility', router);

beforeEach(() => vi.resetAllMocks());

describe('eligibility confirmation route', () => {
  it('requires an authenticated administrator identity and valid path', async () => {
    expect((await request(app).post(`/api/admin/eligibility/filing/${ID}/verify`).send({ expectedValue: 2025 })).status).toBe(403);
    expect((await request(authenticated).post(`/api/admin/eligibility/invalid/${ID}/verify`).send({ expectedValue: 2025 })).status).toBe(400);
    expect(verification).not.toHaveBeenCalled();
  });

  it('forwards the exact reviewed value and the real administrator ID', async () => {
    verification.mockResolvedValue({ verified: true, detectionRunId: 'run' });
    const result = await request(authenticated).post(`/api/admin/eligibility/filing/${ID}/verify`).send({ expectedValue: 2025 });
    expect(result.status).toBe(200);
    expect(verification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'filing', id: ID, expectedValue: 2025, adminUserId: 'admin-1' }));
    expect(result.body.data).toEqual({ verified: true, detectionRunId: 'run' });
  });

  it('distinguishes invalid, stale, and missing records', async () => {
    for (const [error, status] of [['INVALID_EXPECTED_VALUE', 400], ['STALE_VALUE', 409], ['NOT_FOUND', 404]]) {
      verification.mockResolvedValueOnce({ error });
      const response = await request(authenticated).post(`/api/admin/eligibility/agenda/${ID}/verify`).send({ expectedValue: '2025-01-01T00:00:00.000Z' });
      expect(response.status).toBe(status);
      expect(response.body.error).toBe(error);
    }
  });
});