import { describe, expect, it, vi } from 'vitest';
import { downloadPdf, runApifyAgendaCli, runApifyAgendaScrape } from '../../src/jobs/runApifyAgendaScrape.js';

function createPrismaDouble() {
  const sources = [];
  const agendaItems = new Map();
  const syncLogs = [];
  const syncJobRuns = [];
  let sourceNumber = 0;
  let syncLogNumber = 0;
  let syncJobRunNumber = 0;
  const agendaKey = (key) => JSON.stringify({
    cityId: key.cityId,
    meetingDate: new Date(key.meetingDate).toISOString(),
    itemNumber: key.itemNumber,
  });

  const prisma = {
    dataSource: {
      findFirst: vi.fn(async ({ where }) => sources.find((source) => (
        source.cityName === where.cityName && source.sourceType === where.sourceType
      )) ?? null),
      create: vi.fn(async ({ data }) => {
        const source = { id: `source-${++sourceNumber}`, ...data };
        sources.push(source);
        return source;
      }),
      update: vi.fn(async ({ where, data }) => {
        const source = sources.find((entry) => entry.id === where.id);
        Object.assign(source, data);
        return source;
      }),
    },
    syncLog: {
      create: vi.fn(async ({ data }) => {
        const syncLog = { id: `sync-${++syncLogNumber}`, ...data };
        syncLogs.push(syncLog);
        return syncLog;
      }),
      update: vi.fn(async ({ where, data }) => {
        const syncLog = syncLogs.find((entry) => entry.id === where.id);
        Object.assign(syncLog, data);
        return syncLog;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const selected = syncLogs.filter((entry) => (
          (!where.jobRunId || entry.jobRunId === where.jobRunId)
          && (!where.status || entry.status === where.status)
        ));
        selected.forEach((entry) => Object.assign(entry, data));
        return { count: selected.length };
      }),
    },
    syncJobRun: {
      findMany: vi.fn(async ({ where }) => syncJobRuns
        .filter((run) => (
          run.jobKey === where.jobKey
          && run.status === where.status
          && run.heartbeatAt < where.heartbeatAt.lt
        ))
        .map(({ id }) => ({ id }))),
      create: vi.fn(async ({ data }) => {
        const record = { id: `job-${++syncJobRunNumber}`, ...data };
        syncJobRuns.push(record);
        return { id: record.id };
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const record = syncJobRuns.find((run) => (
          run.id === where.id
          && run.status === where.status
          && run.heartbeatAt < where.heartbeatAt.lt
        ));
        if (record) Object.assign(record, data);
        return { count: record ? 1 : 0 };
      }),
      update: vi.fn(async ({ where, data }) => {
        const record = syncJobRuns.find((run) => run.id === where.id);
        Object.assign(record, data);
        return record;
      }),
    },
    agendaItem: {
      findUnique: vi.fn(async ({ where }) => {
        const row = agendaItems.get(agendaKey(where.cityId_meetingDate_itemNumber));
        return row ? { ...row } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = agendaKey(where.cityId_meetingDate_itemNumber);
        const existing = agendaItems.get(key);
        const row = existing
          ? Object.assign(existing, update)
          : { id: `agenda-${agendaItems.size + 1}`, ...create };
        agendaItems.set(key, row);
        return row;
      }),
      count: vi.fn(async ({ where }) => [...agendaItems.values()].filter((row) => (
        row.cityId === where.cityId
        && row.meetingDate >= where.meetingDate.gte
        && row.meetingDate < where.meetingDate.lt
      )).length),
    },
    $transaction: vi.fn(async (operations) => (
      typeof operations === 'function' ? operations(prisma) : Promise.all(operations)
    )),
  };

  return { prisma, sources, agendaItems, syncLogs, syncJobRuns };
}

function pdfResponse(body = 'pdf') {
  const pdf = body.startsWith('%PDF-') ? body : `%PDF-1.7\n${body}`;
  return new Response(pdf, { headers: { 'content-length': String(Buffer.byteLength(pdf)) } });
}

describe('downloadPdf', () => {
  it('rejects a PDF whose declared content length exceeds the limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('%PDF-small', {
      headers: { 'content-length': '21' },
    }));

    await expect(downloadPdf('https://city.test/agenda.pdf', { fetchImpl, maxBytes: 20 }))
      .rejects.toThrow('PDF exceeds 0 MB limit');
  });

  it('returns a buffer for a successful PDF download', async () => {
    const buffer = await downloadPdf('https://city.test/agenda.pdf', {
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse('agenda')),
    });

    expect(buffer.toString()).toContain('agenda');
  });

  it('enforces the byte limit when the response omits content-length', async () => {
    const oversizedPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);
    await expect(downloadPdf('https://city.test/agenda.pdf', {
      fetchImpl: vi.fn().mockResolvedValue(new Response(oversizedPdf)),
      maxBytes: 16,
    })).rejects.toThrow('PDF exceeds 0 MB limit');
  });
});

describe('runApifyAgendaScrape', () => {
  const parsePdf = vi.fn(async (_buffer, cityId, meetingDate) => [{
    cityId,
    meetingDate,
    itemNumber: '1',
    itemText: 'Approve a public works contract.',
    sourceType: 'pdf',
  }]);
  const detect = vi.fn(async () => ({ inserted: 0, skipped: 0, totalCandidates: 0 }));

  it('records source scrape failures and marks the scheduled run failed', async () => {
    const state = createPrismaDouble();
    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: async ({ onSourceError }) => {
        onSourceError({ cityName: 'Unavailable City' }, new Error('Provider unavailable'));
        return [];
      },
      log: vi.fn(),
    });

    expect(result.errors).toBe(1);
    expect(result.sourceErrors).toEqual([{ cityName: 'Unavailable City', message: 'Provider unavailable' }]);
    expect(state.syncJobRuns[0].status).toBe('failed');
  });

  it('rejects invalid or incomplete explicit backfill ranges', async () => {
    const scrapeAgendaPDFs = vi.fn();
    await expect(runApifyAgendaScrape({
      startDate: '2024-01-01',
      scrapeAgendaPDFs,
      prismaClient: createPrismaDouble().prisma,
    })).rejects.toThrow('must be provided together');
    await expect(runApifyAgendaScrape({
      startDate: '2024-02-31',
      endDate: '2024-03-01',
      scrapeAgendaPDFs,
      prismaClient: createPrismaDouble().prisma,
    })).rejects.toThrow('--start must use YYYY-MM-DD');
    expect(scrapeAgendaPDFs).not.toHaveBeenCalled();
  });

  it('downloads, parses, persists, and logs an Apify PDF result', async () => {
    const state = createPrismaDouble();
    const scrapeAgendaPDFs = vi.fn().mockResolvedValue([{
      pdf_url: 'https://city.test/agenda.pdf',
      meeting_date: '2026-10-01',
      city_name: 'Test City',
    }]);

    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs,
      parsePdf,
      detect,
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    });

    expect(scrapeAgendaPDFs).toHaveBeenCalledWith(expect.objectContaining({
      lookbackDays: 14,
      onSourceComplete: expect.any(Function),
      onSourceError: expect.any(Function),
    }));
    expect(result).toMatchObject({ citiesProcessed: 1, pdfsFetched: 1, inserted: 1, skipped: 0, errors: 0 });
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]).toMatchObject({
      cityName: 'Test City',
      sourceType: 'apify',
      lastError: null,
      lastDocumentsFound: 1,
      lastPdfsFetched: 1,
      lastItemsInserted: 1,
      lastItemsSkipped: 0,
    });
    expect(state.agendaItems.size).toBe(1);
    expect(state.syncLogs[0]).toMatchObject({
      status: 'success',
      itemsFound: 1,
      documentsFound: 1,
      pdfsFetched: 1,
      documentsSkipped: 0,
      itemsInserted: 1,
      itemsSkipped: 0,
      errors: null,
    });
    expect([...state.agendaItems.values()][0]).toMatchObject({
      itemText: 'Approve a public works contract.',
      sourceUrl: 'https://city.test/agenda.pdf',
      sourceType: 'apify',
    });
  });

  it('continues with other cities after one city has a provider/document failure', async () => {
    const state = createPrismaDouble();
    const parseCityAgenda = vi.fn(async (_buffer, cityId, meetingDate) => {
      if (cityId === 'source-1') throw new Error('PDF provider unavailable');
      return [{
        cityId,
        meetingDate,
        itemNumber: '1',
        itemText: 'Approve a public works contract.',
      }];
    });

    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([
        { pdf_url: 'https://one.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'City One' },
        { pdf_url: 'https://two.test/agenda.pdf', meeting_date: '2026-10-02', city_name: 'City Two' },
      ]),
      parsePdf: parseCityAgenda,
      detect,
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      citiesProcessed: 2,
      errors: 1,
      itemsInserted: 1,
    });
    expect(state.syncLogs.map(({ status }) => status)).toEqual(['failed', 'success']);
    expect(state.sources[0].lastError).toContain('PDF provider unavailable');
    expect(state.agendaItems.size).toBe(1);
  });

  it('records a successfully scraped city even when its historical window has no documents', async () => {
    const state = createPrismaDouble();
    const scrapeAgendaPDFs = vi.fn(async ({ onSourceComplete }) => {
      onSourceComplete({ cityName: 'Empty Archive City' });
      return [];
    });

    const result = await runApifyAgendaScrape({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      prismaClient: state.prisma,
      scrapeAgendaPDFs,
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      citiesProcessed: 1,
      documentsFound: 0,
      documentsSkipped: 0,
      errors: 0,
      cities: [{ cityName: 'Empty Archive City', documentsFound: 0 }],
    });
    expect(state.syncLogs[0]).toMatchObject({ status: 'success', documentsFound: 0 });
  });

  it('filters custom scraper results to the explicit dates and rechecks prior rows', async () => {
    const state = createPrismaDouble();
    const detectHistorical = vi.fn().mockResolvedValue({ inserted: 0, skipped: 0, totalCandidates: 0 });
    state.prisma.agendaItem.findUnique.mockResolvedValue({
      id: 'existing-agenda-id',
      title: 'Approve a public works contract.',
      description: null,
      itemText: 'Approve a public works contract.',
    });
    const scrapeAgendaPDFs = vi.fn().mockResolvedValue([
      { pdf_url: 'https://city.test/in-range.pdf', meeting_date: '2024-02-01', city_name: 'Test City' },
      { pdf_url: 'https://city.test/out-of-range.pdf', meeting_date: '2025-02-01', city_name: 'Test City' },
    ]);

    const result = await runApifyAgendaScrape({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      prismaClient: state.prisma,
      scrapeAgendaPDFs,
      parsePdf,
      detect: detectHistorical,
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    });

    expect(scrapeAgendaPDFs).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }));
    expect(result).toMatchObject({
      documentsFound: 1,
      documentsOutsideWindow: 1,
      skipped: 2,
      finalItemCount: 1,
      cities: [{ finalItemCount: 1 }],
    });
    expect(state.agendaItems.size).toBe(1);
    expect(detectHistorical).toHaveBeenCalledWith(['agenda-1'], { prisma: state.prisma });
  });

  it('detects conflicts for newly inserted agenda items and records the count', async () => {
    const state = createPrismaDouble();
    const detect = vi.fn().mockResolvedValue({ inserted: 2, skipped: 1, totalCandidates: 3 });

    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([{
        pdf_url: 'https://city.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'Test City',
      }]),
      parsePdf,
      detect,
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      log: vi.fn(),
    });

    expect(detect).toHaveBeenCalledWith(['agenda-1'], { prisma: state.prisma });
    expect(result).toMatchObject({
      conflictCandidates: 3,
      conflictsDetected: 2,
      conflictsSkipped: 1,
      detectionFailures: 0,
    });
    expect(state.syncLogs[0]).toMatchObject({
      conflictCandidates: 3,
      conflictsDetected: 2,
      conflictsSkipped: 1,
      detectionErrors: [],
    });
  });

  it('records detection errors without marking successful agenda ingestion as failed', async () => {
    const state = createPrismaDouble();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([{
        pdf_url: 'https://city.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'Test City',
      }]),
      parsePdf,
      detect: vi.fn().mockRejectedValue(new Error('detector unavailable')),
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      inserted: 1,
      errors: 0,
      conflictCandidates: 0,
      conflictsDetected: 0,
      conflictsSkipped: 0,
      detectionFailures: 1,
      detectionErrors: [expect.objectContaining({ message: 'detector unavailable' })],
    });
    expect(state.syncLogs[0]).toMatchObject({
      status: 'success',
      itemsInserted: 1,
      errors: null,
      detectionErrors: [expect.objectContaining({ message: 'detector unavailable' })],
    });
    expect(state.syncJobRuns[0].status).toBe('failed');
    expect(errorLog).toHaveBeenCalled();
    expect(state.syncJobRuns.map(({ status }) => status)).toEqual(['failed', 'failed']);
    errorLog.mockRestore();
  });

  it('does not duplicate or redetect unchanged agenda items when the same actor result is rerun', async () => {
    const state = createPrismaDouble();
    const detect = vi.fn(async () => ({ inserted: 0, skipped: 0, totalCandidates: 0 }));
    const options = {
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([{
        pdf_url: 'https://city.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'Test City',
      }]),
      parsePdf,
      detect,
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    };

    await runApifyAgendaScrape(options);
    const rerun = await runApifyAgendaScrape(options);

    expect(state.agendaItems.size).toBe(1);
    expect(rerun).toMatchObject({ inserted: 0, skipped: 1, errors: 0 });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('redetects an existing agenda item when parsed content materially changes', async () => {
    const state = createPrismaDouble();
    const parsePdf = vi.fn()
      .mockResolvedValueOnce([{
        cityId: 'source-1',
        meetingDate: new Date('2026-10-01'),
        itemNumber: '1',
        itemText: 'Approve a public works contract.',
        sourceType: 'pdf',
      }])
      .mockResolvedValueOnce([{
        cityId: 'source-1',
        meetingDate: new Date('2026-10-01'),
        itemNumber: '1',
        itemText: 'Approve Acme public works contract.',
        sourceType: 'pdf',
      }]);
    const detect = vi.fn(async () => ({ inserted: 1, skipped: 0, totalCandidates: 1 }));
    const options = {
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([{
        pdf_url: 'https://city.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'Test City',
      }]),
      parsePdf,
      detect,
      fetchImpl: vi.fn().mockImplementation(async () => pdfResponse()),
      log: vi.fn(),
    };

    await runApifyAgendaScrape(options);
    const updated = await runApifyAgendaScrape(options);

    expect(updated).toMatchObject({ inserted: 0, skipped: 1, conflictsDetected: 1, errors: 0 });
    expect(detect).toHaveBeenNthCalledWith(1, ['agenda-1'], { prisma: state.prisma });
    expect(detect).toHaveBeenNthCalledWith(2, ['agenda-1'], { prisma: state.prisma });
    expect(state.agendaItems.size).toBe(1);
  });

  it('skips one failed PDF, records its error, and continues with the next PDF', async () => {
    const state = createPrismaDouble();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(pdfResponse());

    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([
        { pdf_url: 'https://city.test/missing.pdf', meeting_date: '2026-10-01', city_name: 'Test City' },
        { pdf_url: 'https://city.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'Test City' },
      ]),
      parsePdf,
      detect,
      fetchImpl,
      log: vi.fn(),
    });

    expect(result).toMatchObject({ inserted: 1, skipped: 1, documentsSkipped: 1, errors: 1 });
    expect(state.agendaItems.size).toBe(1);
    expect(state.syncLogs[0]).toMatchObject({ status: 'success', itemsInserted: 1, itemsSkipped: 0 });
    expect(state.syncLogs[0].errors).toEqual([expect.objectContaining({ pdfUrl: 'https://city.test/missing.pdf' })]);
    expect(state.sources[0].lastError).toContain('PDF download failed (404 Not Found)');
  });

  it('only processes the requested city for a manual city-filtered run', async () => {
    const state = createPrismaDouble();
    const result = await runApifyAgendaScrape({
      city: 'Second City',
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([
        { pdf_url: 'https://one.test/agenda.pdf', meeting_date: '2026-10-01', city_name: 'First City' },
        { pdf_url: 'https://two.test/agenda.pdf', meeting_date: '2026-10-02', city_name: 'Second City' },
      ]),
      parsePdf,
      detect,
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      log: vi.fn(),
    });

    expect(result).toMatchObject({ citiesProcessed: 1, pdfsFetched: 1, inserted: 1 });
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].cityName).toBe('Second City');
  });

  it('skips URL-only parsed text, malformed URLs, and unavailable PDFs without storing URLs', async () => {
    const state = createPrismaDouble();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(pdfResponse())
      .mockResolvedValueOnce(new Response('missing', { status: 404, statusText: 'Not Found' }));
    const parseWithUrlOnlyText = vi.fn(async (_buffer, cityId, meetingDate) => [{
      cityId, meetingDate, itemNumber: '1', itemText: 'https://city.test/agenda.pdf',
    }]);
    const result = await runApifyAgendaScrape({
      prismaClient: state.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue([
        { pdf_url: 'https://city.test/url-only.pdf', meeting_date: '2026-10-01', city_name: 'Test City' },
        { pdf_url: 'not a url', meeting_date: '2026-10-01', city_name: 'Test City' },
        { pdf_url: 'https://city.test/missing.pdf', meeting_date: '2026-10-01', city_name: 'Test City' },
      ]),
      parsePdf: parseWithUrlOnlyText,
      fetchImpl,
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      documentsFound: 3,
      pdfsFetched: 1,
      documentsSkipped: 3,
      itemsInserted: 0,
      errors: 3,
    });
    expect(state.agendaItems.size).toBe(0);
    expect(state.syncLogs[0]).toMatchObject({
      status: 'failed',
      documentsFound: 3,
      pdfsFetched: 1,
      documentsSkipped: 3,
    });
  });

  it('routes CLI execution through the same Apify agenda job', async () => {
    const run = vi.fn().mockResolvedValue({ errors: 0, documentsFound: 0 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runApifyAgendaCli({ argv: ['--city', 'Test City'], run });

    expect(run).toHaveBeenCalledWith({ city: 'Test City' });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ errors: 0, documentsFound: 0 }, null, 2));
    log.mockRestore();
  });

  it('passes an explicit historical range through the CLI', async () => {
    const previousExitCode = process.exitCode;
    const run = vi.fn().mockResolvedValue({
      errors: 0, detectionFailures: 0, citiesProcessed: 1,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runApifyAgendaCli({
      argv: ['--city', 'Test City', '--start', '2024-01-01', '--end', '2024-12-31'],
      run,
    });

    expect(run).toHaveBeenCalledWith({
      city: 'Test City', startDate: '2024-01-01', endDate: '2024-12-31',
    });
    expect(process.exitCode).toBe(previousExitCode);
    log.mockRestore();
  });

  it('sets a failing CLI exit code when a concurrent run was skipped', async () => {
    const previousExitCode = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runApifyAgendaCli({
      argv: [],
      run: vi.fn().mockResolvedValue({ errors: 0, skippedRun: true }),
    });

    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
    log.mockRestore();
  });

  it('returns finite zero totals for empty datasets and counts missing-city results', async () => {
    for (const [items, skipped] of [[[], 0], [[{ pdf_url: 'https://city.test/a.pdf' }], 1]]) {
      const state = createPrismaDouble();
      const result = await runApifyAgendaScrape({
        prismaClient: state.prisma, scrapeAgendaPDFs: vi.fn().mockResolvedValue(items), log: vi.fn(),
      });
      expect(result).toMatchObject({
        citiesProcessed: 0, documentsFound: 0, pdfsFetched: 0, documentsSkipped: 0,
        itemsInserted: 0, itemsSkipped: 0, inserted: 0, skipped, errors: skipped,
        conflictCandidates: 0, conflictsDetected: 0, detectionFailures: 0,
      });
      expect(state.prisma.dataSource.create).not.toHaveBeenCalled();
    }
  });
});