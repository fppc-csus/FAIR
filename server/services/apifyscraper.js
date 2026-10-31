import { ApifyClient } from 'apify-client';
import { prisma } from '../src/lib/prisma.js';
import { apifySourceDiagnostic, buildApifyActorInput } from '../src/ingestion/apifyActorInput.js';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

export async function scrapeAgendaPDFs({ lookbackDays = 14 } = {}) {
  const results = [];
  const sources = await prisma.dataSource.findMany({
    where: { sourceType: 'apify', enabled: true },
    select: { cityName: true, startUrl: true, apifyActorId: true },
    orderBy: { cityName: 'asc' },
  });

  for (const source of sources) {
    const actorId = source.apifyActorId ?? process.env.APIFY_ACTOR_ID;
    if (!actorId) throw new Error(`No Apify actor configured for ${source.cityName}`);
    const actorSource = { ...source, apifyActorId: actorId };
    const input = buildApifyActorInput(actorSource, { lookbackDays });
    console.info('[cron][apify] invoking actor', apifySourceDiagnostic(actorSource));
    const run = await client.actor(actorId).call(input);

    if (run.status && run.status !== 'SUCCEEDED') {
      throw new Error(`Apify actor ${run.status} for ${city.cityName}: ${run.statusMessage || 'Check the Apify run log.'}`);
    }
    if (!run.defaultDatasetId) {
      throw new Error(`Apify actor run for ${city.cityName} did not return a dataset ID.`);
    }
    const dataset = client.dataset(run.defaultDatasetId);
    for (let offset = 0; ; offset += 1000) {
      const { items = [] } = await dataset.listItems({ limit: 1000, offset });
      if (!Array.isArray(items)) throw new Error(`Apify dataset for ${city.cityName} returned invalid results.`);
      results.push(...items.map((item) => ({
        ...item,
        city_name: item.city_name ?? item.cityName ?? city.cityName,
      })));
      if (items.length < 1000) break;
    }
  }

  return results; // [{ pdf_url, meeting_date, city_name }, ...]
}