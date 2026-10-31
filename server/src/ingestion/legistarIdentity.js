/** Legistar numeric IDs are local to a client, not globally unique. */
export function legistarItemKey(baseUrl, itemId) {
  const url = new URL(baseUrl);
  const client = url.pathname.replace(/\/+$/, '').split('/').pop()?.toLowerCase();
  if (!client || itemId == null || String(itemId).trim() === '') {
    throw new Error('Legistar item identity requires a client and item ID');
  }
  return `${client}:${itemId}`;
}