import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getRecord: vi.fn(), pushItems: vi.fn(), setRecord: vi.fn(), scrape: vi.fn(),
  readFile: vi.fn(), mkdir: vi.fn(), appendFile: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('apify-client', () => ({ ApifyClient: class {
  keyValueStore() { return { getRecord: mocks.getRecord, setRecord: mocks.setRecord }; }
  dataset() { return { pushItems: mocks.pushItems }; }
} }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile, mkdir: mocks.mkdir, appendFile: mocks.appendFile, writeFile: mocks.writeFile }));
vi.mock('../src/scraper.js', async (original) => ({ ...await original<object>(), scrape: mocks.scrape }));
import { run } from '../src/runtime.js';
afterEach(() => vi.resetAllMocks());
const input = { startUrl: 'https://city.test/', cityName: 'Test' };
const env = { ACTOR_DEFAULT_KEY_VALUE_STORE_ID: 'store', ACTOR_DEFAULT_DATASET_ID: 'dataset', APIFY_TOKEN: 'test' };
it('loads cloud input and writes dataset records and a summary', async () => {
  mocks.getRecord.mockResolvedValue({ value: input });
  mocks.scrape.mockImplementation(async (_input, _fetch, emit) => { await emit({ pdf_url: 'https://city.test/a.pdf' }); return { records: 1 }; });
  expect(await run(env)).toEqual({ records: 1 });
  expect(mocks.pushItems).toHaveBeenCalledWith({ pdf_url: 'https://city.test/a.pdf' });
  expect(mocks.setRecord).toHaveBeenCalledWith({ key: 'SUMMARY', value: { records: 1 } });
});
it('rejects incomplete cloud configuration', async () => {
  await expect(run({ APIFY_IS_AT_HOME: '1' })).rejects.toThrow('Missing Actor');
});
it('propagates cloud dataset errors', async () => {
  mocks.getRecord.mockResolvedValue({ value: input });
  mocks.pushItems.mockRejectedValue(new Error('offline'));
  mocks.scrape.mockImplementation(async (_input, _fetch, emit) => emit({}));
  await expect(run(env)).rejects.toThrow('Dataset write failed');
});
it('writes local JSONL without cloud credentials', async () => {
  mocks.readFile.mockResolvedValue(JSON.stringify(input));
  mocks.scrape.mockImplementation(async (_input, _fetch, emit) => { await emit({ city_name: 'Test' }); return { records: 1 }; });
  await run({ INPUT_PATH: 'input.json' });
  expect(mocks.appendFile).toHaveBeenCalledWith('storage/dataset.jsonl', '{"city_name":"Test"}\n');
});