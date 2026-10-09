import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { publicUrl } from './scraper.js';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    // Only global unicast; exclude mapped IPv4 and special-purpose ranges.
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0:|db8:)/i.test(address);
  }
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}

export async function fetchDocument(url: string): Promise<Response> {
  const target = publicUrl(url);
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Non-public host blocked');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      const response = await fetch(target, {
        headers: { 'User-Agent': 'FAIRAgendaFinder/1.0', Accept: 'text/html,application/pdf,text/plain' },
        signal: AbortSignal.timeout(30_000), redirect: 'manual',
      });
      // No automatic redirect traversal: preserves robots and host boundaries.
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('Redirect blocked; configure the final public source URL');
      }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        throw new Error(`Retryable HTTP ${response.status}`);
      }
      const limit = 20 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Error('Response exceeds 20 MB');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) { await reader.cancel(); throw new Error('Response exceeds 20 MB'); }
          chunks.push(value);
        }
      }
      return new Response(response.status === 204 ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error('Request exhausted retries');
}