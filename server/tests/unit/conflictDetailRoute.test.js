import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = vi.hoisted(() => ({
  conflict: { findUnique: vi.fn() },
  scheduleAInvestment: { findMany: vi.fn() },
  scheduleBRealEstate: { findMany: vi.fn() },
  scheduleA2BusinessPosition: { findMany: vi.fn() },
  scheduleCdeIncome: { findMany: vi.fn() },
}));
vi.mock('../../src/lib/prisma.js', () => ({ default: db, prisma: db }));

import conflictsRouter from '../../src/routes/conflicts.js';

const app = express();
app.use('/api/conflicts', conflictsRouter);
const id = 'e62f84af-4b46-4b75-a286-25720a30a453';
const politicianId = '3ecbdca3-c69d-4a38-9e41-a57f31d0973e';

beforeEach(() => vi.clearAllMocks());

describe('public conflict detail', () => {
  it('returns 400 for malformed and 404 for missing IDs', async () => {
    expect((await request(app).get('/api/conflicts/not-an-id')).status).toBe(400);
    expect(db.conflict.findUnique).not.toHaveBeenCalled();
    db.conflict.findUnique.mockResolvedValue(null);
    expect((await request(app).get(`/api/conflicts/${id}`)).status).toBe(404);
  });

  it('returns the disclosure and full agenda without authentication', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'INVESTMENT', severity: 'HIGH',
      ruleReference: 'Cal. Gov. Code §87103(a)', entityName: 'Acme', sourceKey: 'INVESTMENT:acme',
      politician: { fullName: 'Alex Rivera', district: '4' },
      agendaItem: {
        title: 'Contract', itemText: 'Full text about Acme', description: 'Short summary',
        meetingDate: null, cityName: null,
        meeting: { meetingDate: new Date('2026-09-15T00:00:00Z'), jurisdiction: { name: 'Sacramento' } },
      },
    });
    db.scheduleAInvestment.findMany.mockResolvedValue([{
      entityName: 'Acme, Inc.', fairMarketValue: '$10,000 - $100,000', natureOfInvestment: 'Stock',
    }]);

    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.politician).toEqual({ id: politicianId, name: 'Alex Rivera', district: '4' });
    expect(response.body.data.scheduleEntry).toEqual({
      scheduleType: 'A', entityName: 'Acme, Inc.', dollarValue: '$10,000 - $100,000', natureOfInterest: 'Stock',
    });
    expect(response.body.data.agendaItem).toMatchObject({ text: 'Full text about Acme', city: 'Sacramento' });
    expect(db.scheduleAInvestment.findMany.mock.calls[0][0].where.OR[1].filing.politicianId).toBe(politicianId);
  });

  it('matches real estate source keys that abbreviate street names', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'REAL_ESTATE', severity: 'MEDIUM', sourceKey: 'REAL_ESTATE:123 main st',
      politician: { fullName: 'Alex Rivera' }, agendaItem: { title: 'Zoning', meeting: null },
    });
    db.scheduleBRealEstate.findMany.mockResolvedValue([{ propertyDescription: '123 Main Street', fairMarketValue: '$2,000' }]);
    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.scheduleEntry.entityName).toBe('123 Main Street');
  });

  it('loads the exact supporting disclosure when provenance is available', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'INVESTMENT', sourceKey: 'INVESTMENT:acme',
      filingId: id, disclosureId: politicianId, filingYear: 2025, supportingSource: 'private/file.xlsx', eligibilityStatus: 'inactive',
      politician: { fullName: 'Alex Rivera' }, agendaItem: { title: 'Contract', meeting: null },
    });
    db.scheduleAInvestment.findFirst = vi.fn().mockResolvedValue({ entityName: 'Acme', fairMarketValue: '$10,000' });
    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ eligibilityStatus: 'inactive', filingId: id, disclosureId: politicianId, supportingSource: 'private/file.xlsx' });
    expect(db.scheduleAInvestment.findFirst).toHaveBeenCalledWith({ where: { id: politicianId, filingId: id, filing: { politicianId } } });
    expect(db.scheduleAInvestment.findMany).not.toHaveBeenCalled();
  });
});
