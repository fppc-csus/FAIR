import { describe, expect, it } from 'vitest';
import { legistarItemKey } from '../../src/ingestion/legistarIdentity.js';

describe('Legistar client-scoped identity', () => {
  it('keeps equal numeric IDs from different clients distinct', () => {
    expect(legistarItemKey('https://webapi.legistar.com/v1/sonoma-county/', 42)).toBe('sonoma-county:42');
    expect(legistarItemKey('https://webapi.legistar.com/v1/sacramento', 42)).toBe('sacramento:42');
  });
  it('rejects missing item IDs', () => {
    expect(() => legistarItemKey('https://webapi.legistar.com/v1/example', null)).toThrow();
  });
});