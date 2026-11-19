import { describe, expect, it } from 'vitest';
import { compactAcronym, contextTermsFor, entityVariants, findEntityMentions, isAmbiguousName, isCorroborated } from '../../src/detection/entityContext.js';
import { matchNamedEntity } from '../../src/detection/matchEntity.js';
import { evidenceExcerpt } from '../../src/routes/conflicts.js';

describe('acronym and alias matching (PG&E = PGE = Pacific Gas and Electric)', () => {
  it('normalises acronyms', () => {
    expect(compactAcronym('PG&E')).toBe('pge');
    expect(compactAcronym('P.G.&E.')).toBe('pge');
    expect(compactAcronym('Apple')).toBeNull();
  });

  it.each([
    ['AIR PROD & CHEMICALS', 'Attachment 3 Draft Ordinance.pdf; Attachment 4 Planning Commission Staff Report.pdf'],
    ['Annaly Capital Management', 'Chris Knerr is the Business Agent for Cement Masons Local 300.'],
    ['Deutsch Family Wine', 'Due to the February 2019 Winter Storms and Flooding, Sonoma Water acted.'],
  ])('never guesses %s from unrelated capitalised words', async (name, text) => {
    expect((await matchNamedEntity(name, text)).matched).toBe(false);
  });

  it.each([
    ['PG&E', 'Approve an easement with Pacific Gas and Electric Company for a pole line.'],
    ['PG&E', 'Agreement with PGE for streetlight conversion.'],
    ['PGE', 'Rule 20A undergrounding with PG&E on Main Street.'],
    ['Pacific Gas and Electric Company', 'Franchise fee audit of P.G.&E. electric revenues.'],
    ['Pacific Gas & Electric', 'Agreement with Pacific Gas and Electric for EV chargers.'],
    ['Southern California Edison', 'Rate settlement with SCE.'],
  ])('matches %s in "%s"', async (name, text) => {
    expect((await matchNamedEntity(name, text)).matched).toBe(true);
  });

  it('does not invent acronym matches from unrelated capitalised words or lower-case text', async () => {
    expect((await matchNamedEntity('PG&E', 'Planning, Grants. Engineering staff report.')).matched).toBe(false);
    expect((await matchNamedEntity('Pacific Gas and Electric', 'the page was updated')).matched).toBe(false);
  });

  it('lists aliases from the configured groups', () => {
    expect(entityVariants('PGE')).toEqual(expect.arrayContaining(['Pacific Gas and Electric Company', 'PG&E']));
  });

  it('highlights the alias that matched in the evidence excerpt', () => {
    expect(evidenceExcerpt('Easement for Pacific Gas and Electric Company poles', 'PG&E').match).toBe('Pacific Gas and Electric');
  });
});

describe('ordinary-word company names (Apple the company vs apple the fruit)', () => {
  const tech = 'Technology';

  it('recognises ambiguous one-word names', () => {
    expect(isAmbiguousName('Apple')).toBe(true);
    expect(isAmbiguousName('Apple Inc.')).toBe(true);
    expect(isAmbiguousName('LandPaths')).toBe(false);
    expect(isAmbiguousName('Microsoft')).toBe(false);
    expect(isAmbiguousName('Costco', 'buy costcos')).toBe(true);
  });

  it.each([
    'promotion of the Sebastopol Apple Blossom Festival and Parade; grant award of $1,500.',
    'law enforcement at the Gravenstein Apple Fair on August 17-18, 2019.',
    'A few remnant orchard trees are present (cherry, apple, and grapefruit).',
  ])('rejects "%s" for a technology investment', async (text) => {
    const result = await matchNamedEntity('Apple', text, { businessActivity: tech });
    expect(result).toMatchObject({ matched: false, ambiguous: true });
  });

  it.each([
    'Original Jurisdiction for Manzana Apple Processing Facility Use Permit and Lot Line Adjustment Application PLP18-0026',
    'Community Investment Grant: Kid Scoop News, $500, for subscriptions and applications in schools.',
  ])('rejects generic agenda vocabulary as corroboration: "%s"', async (text) => {
    const name = text.includes('Scoop') ? 'Scoop' : 'Apple';
    expect((await matchNamedEntity(name, text, { businessActivity: 'Technology' })).matched).toBe(false);
  });

  it.each([
    'Purchase 40 Apple iPads and device management licenses.',
    'Master agreement with Apple Inc. for hardware.',
  ])('accepts "%s"', async (text) => {
    expect((await matchNamedEntity('Apple', text, { businessActivity: tech })).matched).toBe(true);
  });

  it('keeps unambiguous names unchanged (LandPaths, Microsoft)', async () => {
    expect((await matchNamedEntity('LandPaths', 'grantees: LandPaths, $20,000', { businessActivity: 'Non-Profit' })).matched).toBe(true);
    expect((await matchNamedEntity('Microsoft', 'convert to Microsoft SQL Server', { businessActivity: tech })).matched).toBe(true);
  });

  it('derives context vocabulary from the reported business activity', () => {
    expect(contextTermsFor('Technology')).toEqual(expect.arrayContaining(['software', 'iphone']));
    expect(contextTermsFor('Oil, Gas & Consumable Fuels')).toEqual(expect.arrayContaining(['refinery', 'fuels']));
    expect(contextTermsFor('Technology Platform')).not.toContain('platform');
    expect(contextTermsFor('Technology')).not.toEqual(expect.arrayContaining(['application']));
    expect(isCorroborated(findEntityMentions('Scoop', 'Kid Scoop News, $500'), 'Kid Scoop News, $500', tech)).toBe(false);
  });
});
