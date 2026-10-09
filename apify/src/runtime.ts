import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { DatasetError, scrape } from './scraper.js';
import { fetchDocument } from './network.js';
import { resolveInput } from './discovery.js';

export async function run(env: NodeJS.ProcessEnv = process.env) {
  const storeId = env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ?? env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
  const datasetId = env.ACTOR_DEFAULT_DATASET_ID ?? env.APIFY_DEFAULT_DATASET_ID;
  if (storeId || datasetId || env.APIFY_IS_AT_HOME === '1') {
    if (!storeId || !datasetId || !env.APIFY_TOKEN) throw new Error('Missing Actor storage IDs or token');
    const client = new ApifyClient({ token: env.APIFY_TOKEN });
    const record = await client.keyValueStore(storeId).getRecord(env.ACTOR_INPUT_KEY ?? 'INPUT');
    const input = await resolveInput(record?.value, fetchDocument);
    await client.keyValueStore(storeId).setRecord({ key: 'SOURCE', value: { cityName: input.cityName, startUrl: input.startUrl } });
    const summary = await scrape(input, fetchDocument, async (item) => {
      try { await client.dataset(datasetId).pushItems({ ...item }); }
      catch (error) { throw new DatasetError(`Dataset write failed: ${String(error)}`); }
    });
    await client.keyValueStore(storeId).setRecord({ key: 'SUMMARY', value: summary });
    console.log(JSON.stringify(summary));
    return summary;
  }
  const input = await resolveInput(JSON.parse(await readFile(env.INPUT_PATH ?? 'INPUT.example.json', 'utf8')), fetchDocument);
  await mkdir('storage', { recursive: true });
  await writeFile('storage/dataset.jsonl', '');
  const summary = await scrape(input, fetchDocument, async (item) => {
    try { await appendFile('storage/dataset.jsonl', `${JSON.stringify(item)}\n`); }
    catch (error) { throw new DatasetError(`Local dataset write failed: ${String(error)}`); }
  });
  await writeFile('storage/summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  return summary;
}