import { describe, expect, it } from 'vitest';
import { assertLocalTestDatabase } from '../integration/sh324DatabaseGuard.js';

const url = 'postgresql://local@127.0.0.1:5432/fair_sh324_test';
const safe = { RUN_SH324_DB_TESTS: 'true', DATABASE_URL: url, DIRECT_URL: url };

describe('SH-324 database safety gate', () => {
  it('accepts matching, explicit localhost URLs', () => {
    expect(() => assertLocalTestDatabase(safe)).not.toThrow();
  });

  it.each([
    [{ ...safe, RUN_SH324_DB_TESTS: undefined }, 'opt-in'],
    [{ ...safe, DATABASE_URL: undefined }, 'both'],
    [{ ...safe, DIRECT_URL: undefined }, 'both'],
    [{ ...safe, DATABASE_URL: url.replace('127.0.0.1', 'db.production.example') }, 'matching local'],
    [{ ...safe, DIRECT_URL: url.replace('fair_sh324_test', 'postgres') }, 'matching local'],
    [{ ...safe, DIRECT_URL: url.replace(':5432', ':5433') }, 'matching local'],
    [{ ...safe, DIRECT_URL: url.replace('local@', 'someone_else@') }, 'matching local'],
  ])('rejects an unsafe connection before loading the application', (env, message) => {
    expect(() => assertLocalTestDatabase(env)).toThrow(message);
  });
});