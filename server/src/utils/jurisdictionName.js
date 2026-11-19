/**
 * Canonical comparison key for jurisdiction names so the same government
 * written different ways ("County of Sonoma" on a Form 700, "Sonoma County" on
 * a Legistar source, "City of Fresno" vs "Fresno") resolves to one record.
 * Keys are `<kind>:<place>` and never merge a city with a county of the same
 * name (e.g. city:sonoma vs county:sonoma).
 */
export function jurisdictionKey(name) {
  const text = String(name ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  let match = text.match(/^city and county of (.+)$/);
  if (match) return `county:${match[1]}`;
  match = text.match(/^(?:county of (.+)|(.+) county)$/);
  if (match) return `county:${match[1] ?? match[2]}`;
  match = text.match(/^state of (.+)$/);
  if (match) return `state:${match[1]}`;
  match = text.match(/^(?:city|town) of (.+)$/);
  if (match) return `city:${match[1]}`;
  return `city:${text}`;
}

export function sameJurisdictionName(left, right) {
  const key = jurisdictionKey(left);
  return Boolean(key) && key === jurisdictionKey(right);
}

/** Return the jurisdictions whose name has the same canonical key as `name`. */
export function findJurisdictionsByName(jurisdictions, name) {
  const key = jurisdictionKey(name);
  if (!key) return [];
  return jurisdictions.filter((jurisdiction) => jurisdictionKey(jurisdiction.name) === key);
}
