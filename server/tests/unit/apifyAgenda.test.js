import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../src/ingestion/pdfParser.js', () => ({ parsePdfAgenda: vi.fn() }));

import { ingestApifyAgendaItems, QUALITY_SAMPLE_LIMIT } from '../../src/ingestion/apifyAgenda.js';

const source = { id: 'source-1', cityName: 'Elk Grove', sourceType: 'apify' };
const document = {
  pdf_url: 'https://city.gov/agenda.pdf', title: 'Council agenda', meeting_date: '2026-10-01',
};

let prismaClient;
let fetchImpl;
let parsePdf;
let detect;

beforeEach(() => {
  prismaClient = {
    agendaItem: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'agenda-1' }) },
    syncLog: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    syncJobRun: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'job-run-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    dataSource: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (operation) => (
      typeof operation === 'function' ? operation(prismaClient) : Promise.all(operation)
    )),
  };
  fetchImpl = vi.fn(async () => new Response(Buffer.from('%PDF-1.7 agenda')));
  parsePdf = vi.fn().mockResolvedValue([{
    itemNumber: '1', itemText: 'Approve a public works contract.', meetingDate: '2026-10-01',
  }]);
  detect = vi.fn().mockResolvedValue({ inserted: 1, skipped: 0, totalCandidates: 1 });
});

describe('shared Apify agenda ingestion', () => {
  it('persists parsed content, document links, and metrics on the supplied sync run', async () => {
    const result = await ingestApifyAgendaItems({
      items: [document], source, syncLogId: 'sync-1', prismaClient, fetchImpl, parsePdf, detect,
    });

    expect(result).toMatchObject({ documentsFound: 1, pdfsFetched: 1, itemsInserted: 1, errors: [] });
    expect(prismaClient.syncLog.create).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledWith(['agenda-1'], { prisma: prismaClient });
    expect(prismaClient.agendaItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        sourceType: 'apify', cityId: source.id, title: document.title,
        itemText: 'Approve a public works contract.', sourceUrl: document.pdf_url,
      }),
    }));
    expect(prismaClient.syncLog.update).toHaveBeenCalledWith({
      where: { id: 'sync-1' },
      data: expect.objectContaining({
        status: 'success', documentsFound: 1, pdfsFetched: 1, itemsInserted: 1, errors: null,
        conflictCandidates: 1, conflictsDetected: 1, detectionErrors: [],
      }),
    });
  });

  it('retains failed status and document errors when every PDF download fails', async () => {
    fetchImpl.mockRejectedValue(new Error('Download unavailable'));
    const result = await ingestApifyAgendaItems({
      items: [document], source, syncLogId: 'sync-1', prismaClient, fetchImpl, parsePdf, log: vi.fn(),
    });

    expect(result).toMatchObject({
      documentsSkipped: 1,
      itemsInserted: 0,
      documentsDownloadFailed: 1,
      errors: [{ pdfUrl: document.pdf_url, message: 'Download unavailable', quality: 'download-failed' }],
    });
    expect(parsePdf).not.toHaveBeenCalled();
    expect(prismaClient.agendaItem.upsert).not.toHaveBeenCalled();
    expect(prismaClient.syncLog.update).toHaveBeenCalledWith({
      where: { id: 'sync-1' },
      data: expect.objectContaining({
        status: 'failed', documentsSkipped: 1,
        errors: [{ pdfUrl: document.pdf_url, message: 'Download unavailable', quality: 'download-failed' }],
      }),
    });
    expect(prismaClient.dataSource.update).toHaveBeenCalledWith({
      where: { id: source.id },
      data: expect.objectContaining({ lastError: 'Download unavailable', lastDocumentsFound: 1, lastItemsInserted: 0 }),
    });
  });

  it('classifies image-only PDFs (no extractable text) as image-only quality', async () => {
    fetchImpl.mockResolvedValue(new Response(Buffer.from('%PDF-1.7 image-only')));
    parsePdf.mockResolvedValue([]);
    const result = await ingestApifyAgendaItems({
      items: [document], source, syncLogId: 'sync-1', prismaClient, fetchImpl, parsePdf, log: vi.fn(),
    });

    expect(result).toMatchObject({
      documentsSkipped: 1,
      itemsInserted: 0,
      documentsImageOnly: 1,
      errors: [{ pdfUrl: document.pdf_url, quality: 'image-only' }],
    });
    expect(result.sampledDocuments).toHaveLength(1);
    expect(result.sampledDocuments[0]).toMatchObject({
      pdfUrl: document.pdf_url,
      quality: 'image-only',
    });
  });

  it('classifies non-PDF documents as unsupported quality', async () => {
    fetchImpl.mockResolvedValue(new Response(Buffer.from('not a pdf')));
    const result = await ingestApifyAgendaItems({
      items: [document], source, syncLogId: 'sync-1', prismaClient, fetchImpl, parsePdf, log: vi.fn(),
    });

    expect(result).toMatchObject({
      documentsSkipped: 1,
      itemsInserted: 0,
      documentsUnsupported: 1,
      errors: [{ pdfUrl: document.pdf_url, quality: 'unsupported' }],
    });
  });

  it('includes sampled documents up to the quality sample limit', async () => {
    fetchImpl.mockImplementation(async () => new Response(Buffer.from('%PDF-1.7 agenda')));
    parsePdf.mockResolvedValue([{ itemNumber: '1', itemText: 'Approve contract.', meetingDate: '2026-10-01' }]);
    const items = Array.from({ length: 10 }, (_, i) => ({
      ...document,
      pdf_url: `https://city.gov/agenda-${i}.pdf`,
      meeting_date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    }));
    const result = await ingestApifyAgendaItems({
      items, source, syncLogId: 'sync-1', prismaClient, fetchImpl, parsePdf, log: vi.fn(),
    });

    expect(result.documentsWithText).toBe(10);
    expect(result.sampledDocuments).toHaveLength(QUALITY_SAMPLE_LIMIT);
    expect(result.sampledDocuments.every((s) => s.quality === 'has-text')).toBe(true);
  });
});