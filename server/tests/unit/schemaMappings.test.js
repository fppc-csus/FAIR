import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

async function readServerFile(relativePath) {
  return readFile(path.join(serverDirectory, relativePath), 'utf8');
}

function parseSchemaMappings(schema) {
  return new Map(
    [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)].map(([, modelName, body]) => {
      const tableName = body.match(/^\s+@@map\("([^"]+)"\)/m)?.[1];
      const fields = new Map();

      for (const line of body.split(/\r?\n/)) {
        const field = line.match(/^\s{2}([A-Za-z_]\w*)\s+[A-Za-z_]\w*(?:\?|\[\])?\s*(.*)$/);
        if (!field) continue;

        const [, fieldName, attributes] = field;
        fields.set(fieldName, attributes.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName);
      }

      return [modelName, { tableName, fields }];
    }),
  );
}

function expectPhysicalColumns(models, modelName, tableName, columnNames) {
  const model = models.get(modelName);
  expect(model, `Prisma model ${modelName}`).toBeDefined();
  expect(model.tableName).toBe(tableName);

  const physicalColumns = new Set(model.fields.values());
  for (const columnName of columnNames) {
    expect(physicalColumns, `${modelName} maps ${columnName}`).toContain(columnName);
  }
}

describe('Prisma mappings used by ingestion', () => {
  it('maps the Legistar raw SQL tables and insert columns to the Prisma schema', async () => {
    const [schema, nightlySync, apifySync, apifyIngestion] = await Promise.all([
      readServerFile('prisma/schema.prisma'),
      readServerFile('src/jobs/nightlySync.js'),
      readServerFile('src/jobs/runApifyAgendaScrape.js'),
      readServerFile('src/ingestion/apifyAgenda.js'),
    ]);
    const models = parseSchemaMappings(schema);
    const insertColumnsBlock = nightlySync.match(
      /const SNAKE_COLUMNS = \{([\s\S]*?)\};/,
    )?.[1];

    expect(insertColumnsBlock, 'Legistar agenda insert column list').toBeDefined();
    const insertColumns = [...insertColumnsBlock.matchAll(/: '([^']+)'/g)].map(([, name]) => name);
    expect(insertColumns).toContain('item_text');

    expect(nightlySync).toContain('FROM data_sources');
    expect(nightlySync).toContain('INSERT INTO agenda_items');
    expectPhysicalColumns(models, 'DataSource', 'data_sources', [
      'city_name',
      'source_type',
      'enabled',
      'apify_actor_id',
    ]);
    expectPhysicalColumns(models, 'AgendaItem', 'agenda_items', insertColumns);
    expectPhysicalColumns(models, 'AgendaItem', 'agenda_items', [
      'city_id',
      'meeting_date',
      'item_number',
      'item_text',
      'source_type',
      'source_url',
      'city_name',
    ]);
    expectPhysicalColumns(models, 'SyncLog', 'sync_logs', [
      'data_source_id',
      'source_type',
      'status',
      'started_at',
      'completed_at',
      'items_found',
      'items_inserted',
      'items_skipped',
      'conflicts_detected',
      'errors',
    ]);

    const agendaItem = models.get('AgendaItem');
    expect([...agendaItem.fields.keys()]).toEqual(expect.arrayContaining([
      'legistarItemId',
      'sourceType',
      'legistarEventId',
      'legistarMatterId',
      'cityName',
      'agendaNumber',
      'bodyName',
      'meetingDate',
      'eventItemPassedFlag',
      'legistarItemPayload',
    ]));

    expect(apifySync).toContain('ingestApifyAgendaItems(');
    expect(apifyIngestion).toContain('upsertAgendaItems(');
    expect(apifySync).toContain('prismaClient,');
    expect(apifyIngestion).toContain('prismaClient.syncLog.create');
    expect(apifyIngestion).toContain('prismaClient.dataSource.create');
    expect([...models.get('DataSource').fields.keys()]).toEqual(expect.arrayContaining([
      'cityName',
      'sourceType',
      'apifyActorId',
    ]));
    expect([...models.get('SyncLog').fields.keys()]).toEqual(expect.arrayContaining([
      'dataSourceId',
      'sourceType',
      'startedAt',
      'completedAt',
      'itemsFound',
      'itemsInserted',
      'itemsSkipped',
      'conflictsDetected',
      'errors',
    ]));
  });

  it('maps Supabase politician columns used by Form 700 entity resolution', async () => {
    const [schema, findOrCreatePolitician] = await Promise.all([
      readServerFile('prisma/schema.prisma'),
      readServerFile('src/utils/findOrCreatePolitician.js'),
    ]);
    const models = parseSchemaMappings(schema);
    const columns = ['full_name', 'district', 'slug', 'office_title', 'needs_review'];

    expect(findOrCreatePolitician).toContain('.from("politicians")');
    for (const column of columns) {
      expect(findOrCreatePolitician).toContain(column);
    }
    expectPhysicalColumns(models, 'Politician', 'politicians', columns);

    const politician = models.get('Politician');
    expect([...politician.fields.keys()]).toEqual(expect.arrayContaining([
      'fullName',
      'district',
      'slug',
      'officeTitle',
      'needsReview',
    ]));
  });
});
