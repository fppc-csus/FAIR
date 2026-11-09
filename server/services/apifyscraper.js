import { ApifyClient } from 'apify-client';
import { prisma } from '../src/lib/prisma.js';
import { apifySourceDiagnostic, buildApifyActorInput } from '../src/ingestion/apifyActorInput.js';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

export async function scrapeAgendaPDFs({
  lookbackDays = 14,
  startDate,
  endDate,
  city = null,
  onSourceComplete,
  onSourceError,
} = {}) {
  const results = [];
  const errors = [];
  const sources = await prisma.dataSource.findMany({
    where: {
      sourceType: 'apify',
      enabled: true,
      ...(city ? { cityName: { equals: city, mode: 'insensitive' } } : {}),
    },
    select: { cityName: true, startUrl: true, apifyActorId: true },
    orderBy: { cityName: 'asc' },
  });

  for (const source of sources) {
    try {
      const actorId = source.apifyActorId ?? process.env.APIFY_ACTOR_ID;
      if (!actorId) throw new Error(`No Apify actor configured for ${source.cityName}`);
      const actorSource = { ...source, apifyActorId: actorId };
      const input = buildApifyActorInput(actorSource, { lookbackDays, startDate, endDate });
      console.info('[cron][apify] invoking actor', apifySourceDiagnostic(actorSource));
      const run = await client.actor(actorId).call(input);

      if (run.status && run.status !== 'SUCCEEDED') {
        throw new Error(`Apify actor ${run.status} for ${source.cityName}: ${run.statusMessage || 'Check the Apify run log.'}`);
      }
      if (!run.defaultDatasetId) {
        throw new Error(`Apify actor run for ${source.cityName} did not return a dataset ID.`);
      }
      if (startDate) {
        try {
          if (!run.defaultKeyValueStoreId) {
            throw new Error(`Apify historical run for ${source.cityName} did not expose a crawl summary.`);
          }
          const record = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord('SUMMARY');
          const summary = record?.value;
          if (!summary || !Number.isInteger(summary.errors) || !Number.isInteger(summary.remaining)) {
            throw new Error(`Apify historical run for ${source.cityName} returned an invalid crawl summary.`);
          }
          if (summary.errors > 0 || summary.remaining > 0) {
            throw new Error(
              `Apify crawl incomplete for ${source.cityName}: errors=${summary.errors}, remaining=${summary.remaining}`,
            );
          }
        } catch (error) {
          if (onSourceError) onSourceError(source, error);
          else errors.push(error);
        }
      }
      const dataset = client.dataset(run.defaultDatasetId);
      for (let offset = 0; ; offset += 1000) {
        const { items = [] } = await dataset.listItems({ limit: 1000, offset });
        if (!Array.isArray(items)) throw new Error(`Apify dataset for ${source.cityName} returned invalid results.`);
        results.push(...items.map((item) => ({
          ...item,
          city_name: source.cityName,
        })));
        if (items.length < 1000) break;
      }
      if (onSourceComplete) onSourceComplete(source);
    } catch (error) {
      if (onSourceError) onSourceError(source, error);
      else errors.push(error);
    }
  }

  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('; '));
  return results; // [{ pdf_url, meeting_date, city_name }, ...]
}