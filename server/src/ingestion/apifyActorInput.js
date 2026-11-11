const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES = 200;

function requiredString(value, message) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(message);
  return normalized;
}

export function buildApifyActorInput(source, { lookbackDays, startDate, endDate } = {}) {
  const cityName = requiredString(source?.cityName, 'City name is required for an Apify sync.');
  const startUrl = requiredString(
    source?.startUrl,
    `Agenda archive URL is required for ${cityName} before running Apify.`,
  );

  const input = {
    startUrl,
    cityName,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxPages: DEFAULT_MAX_PAGES,
    sameDomainOnly: true,
  };
  if (lookbackDays != null) input.lookbackDays = lookbackDays;
  if (startDate != null) input.startDate = startDate;
  if (endDate != null) input.endDate = endDate;
  return input;
}

export function apifySourceDiagnostic(source) {
  let startUrlHostname = null;
  try {
    startUrlHostname = source?.startUrl ? new URL(source.startUrl).hostname : null;
  } catch {
    startUrlHostname = 'invalid';
  }
  return {
    actorId: source?.apifyActorId ?? null,
    cityName: source?.cityName ?? null,
    hasStartUrl: Boolean(source?.startUrl),
    startUrlHostname,
  };
}