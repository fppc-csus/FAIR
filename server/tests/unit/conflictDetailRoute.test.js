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

  it('returns the disclosure, the matching agenda passage and review state', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'INVESTMENT', severity: 'HIGH',
      ruleReference: 'Cal. Gov. Code §87103(a)', entityName: 'Acme', sourceKey: 'INVESTMENT:acme',
      politician: { fullName: 'Alex Rivera', district: '4', needsReview: true, jurisdiction: { name: 'Sacramento' } },
      reviewStatus: 'pending', reviews: [{ id: 'r1', newStatus: 'pending', note: 'Opened' }],
      agendaItem: {
        title: 'Contract', itemText: 'Full text about Acme', description: 'Short summary', sourceUrl: 'https://example.legistar.com/x',
        meetingDate: null, cityName: null,
        meeting: { meetingDate: new Date('2026-09-15T00:00:00Z'), jurisdiction: { name: 'Sacramento' } },
      },
    });
    db.scheduleAInvestment.findMany.mockResolvedValue([{
      entityName: 'Acme, Inc.', fairMarketValue: '$10,000 - $100,000', natureOfInvestment: 'Stock',
    }]);

    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.politician).toEqual({ id: politicianId, slug: null, name: 'Alex Rivera', officeTitle: null, district: '4', jurisdiction: 'Sacramento', identityVerified: false });
    expect(response.body.data.scheduleEntry).toEqual({
      scheduleType: 'A', entityName: 'Acme, Inc.', dollarValue: '$10,000 - $100,000', natureOfInterest: 'Stock', details: [],
    });
    expect(response.body.data.agendaItem).toMatchObject({
      text: 'Full text about Acme', city: 'Sacramento', sourceUrl: 'https://example.legistar.com/x',
      evidence: { before: 'Full text about ', match: 'Acme', after: '' },
    });
    expect(response.body.data).toMatchObject({ reviewStatus: 'pending', reviews: [{ note: 'Opened' }] });
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
    db.scheduleAInvestment.findFirst = vi.fn().mockResolvedValue({ entityName: 'Acme', fairMarketValue: '$10,000', details: [{ label: 'GENERAL DESCRIPTION OF THIS BUSINESS ACTIVITY', value: 'Paving' }] });
    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ eligibilityStatus: 'inactive', filingId: id, disclosureId: politicianId, supportingSource: 'private/file.xlsx' });
    expect(db.scheduleAInvestment.findFirst).toHaveBeenCalledWith({ where: { id: politicianId, filingId: id, filing: { politicianId } } });
    expect(db.scheduleAInvestment.findMany).not.toHaveBeenCalled();
    expect(response.body.data.scheduleEntry.details).toEqual([{ label: 'GENERAL DESCRIPTION OF THIS BUSINESS ACTIVITY', value: 'Paving' }]);
  });

  it('lists other lines on the same statement that name the same entity', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'INCOME', sourceKey: 'INCOME:sonoma ecology center:disclosure:x',
      entityName: 'Sonoma Ecology Center', filingId: id, disclosureId: politicianId,
      politician: { fullName: 'Caitlin Cornwall' }, agendaItem: { title: 'Grant', meeting: null },
    });
    db.scheduleCdeIncome.findFirst = vi.fn().mockResolvedValue({ id: politicianId, filingId: id, scheduleType: 'C', sourceName: 'Sonoma Ecology Center', amount: '$10,001 - $100,000', details: [{ label: 'CONSIDERATION', value: 'Salary' }] });
    db.scheduleCdeIncome.findMany.mockResolvedValue([
      { id: 's', filingId: id, scheduleType: 'C', sourceName: 'SONOMA ECOLOGY CENTER', amount: '$10,001 - $100,000', details: [{ label: 'CONSIDERATION', value: 'Spouse income' }] },
      { id: 'o', filingId: id, scheduleType: 'C', sourceName: 'LandPaths', amount: '$500' },
    ]);
    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(db.scheduleCdeIncome.findMany).toHaveBeenCalledWith({ where: { filingId: id, id: { not: politicianId } } });
    expect(response.body.data.scheduleEntry.otherLines).toEqual([
      expect.objectContaining({ id: 's', scheduleType: 'C', details: [{ label: 'CONSIDERATION', value: 'Spouse income' }] }),
    ]);
  });

  it('finds the parent disclosure of a related-party candidate on another schedule', async () => {
    db.conflict.findUnique.mockResolvedValue({
      id, politicianId, conflictType: 'INCOME', sourceKey: 'related:INCOME:sonoma ecology center:disclosure:x',
      entityName: 'Sonoma Ecology Center (list single sources of income of $10,000 or more on disclosure for Foggy River Farm)',
      filingId: id, disclosureId: politicianId,
      politician: { fullName: 'Lynda Hopkins' }, agendaItem: { title: 'Grant', itemText: 'Award to Sonoma Ecology Center', meeting: null },
    });
    db.scheduleCdeIncome.findFirst = vi.fn().mockResolvedValue(null);
    db.scheduleA2BusinessPosition.findFirst = vi.fn().mockResolvedValue({ entityName: 'Foggy River Farm', businessPosition: 'Partner' });
    const response = await request(app).get(`/api/conflicts/${id}`);
    expect(response.body.data.scheduleEntry).toMatchObject({ scheduleType: 'A-2', entityName: 'Foggy River Farm' });
    expect(response.body.data.agendaItem.evidence.match).toBe('Sonoma Ecology Center');
  });
});
