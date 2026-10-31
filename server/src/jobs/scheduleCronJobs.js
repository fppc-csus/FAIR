import cron from 'node-cron';
import { runApifyAgendaScrape } from './runApifyAgendaScrape.js';
import { runNightlyLegistarSync } from './nightlySync.js';

export function scheduleCronJobs() {
  const enabled = (process.env.CRON_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[cron] disabled via CRON_ENABLED=false');
    return;
  }

  const legistarSchedule = process.env.LEGISTAR_CRON_SCHEDULE ?? '0 2 * * *';
  cron.schedule(legistarSchedule, async () => {
    try {
      console.log('[cron] starting nightly Legistar sync');
      await runNightlyLegistarSync({
        lookbackDays: process.env.LEGISTAR_LOOKBACK_DAYS
          ? Number(process.env.LEGISTAR_LOOKBACK_DAYS)
          : 30,
      });
    } catch (err) {
      console.error('[cron] nightly Legistar sync failed:', err);
    }
  });
  console.log('[cron] scheduled nightly Legistar sync:', legistarSchedule);

  // Weekly by default (Mondays at 03:10). Railway deployments should ensure only
  // one instance runs this scheduler to avoid duplicate runs.
  const schedule = process.env.APIFY_AGENDA_CRON_SCHEDULE ?? '10 3 * * 1';

  cron.schedule(schedule, async () => {
    try {
      console.log('[cron] starting Apify agenda scrape');
      const result = await runApifyAgendaScrape({
        lookbackDays: process.env.APIFY_LOOKBACK_DAYS
          ? Number(process.env.APIFY_LOOKBACK_DAYS)
          : 14,
      });
      console.log(
        `[cron] Apify agenda ingestion finished: ${result.documentsFound} document(s), ${result.pdfsFetched} PDF(s) fetched, ${result.itemsInserted} agenda item(s) inserted, ${result.itemsSkipped} skipped, ${result.errors} error(s)`,
      );
    } catch (err) {
      console.error('[cron] Apify agenda scrape failed:', err);
    }
  });

  console.log('[cron] scheduled Apify agenda scrape:', schedule);
}
