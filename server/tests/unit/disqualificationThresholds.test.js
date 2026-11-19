import { describe, expect, it } from 'vitest';
import { giftLimitForYear, isGovernmentSource, meetsAmountThreshold } from '../../src/config/conflictRules.js';
import { detectIncomeGiftsTravel } from '../../src/detection/detectIncomeGiftsTravel.js';
import { detectRealEstate, decisionText } from '../../src/detection/detectRealEstate.js';
import { scoreEntityInText } from '../../src/detection/matchEntity.js';
import { isFilerOwnName } from '../../src/detection/detectConflicts.js';
import { relatedNamesFromDetails } from '../../src/parsers/parserUtils.js';

const item = (text, meetingDate = '2019-12-17') => ({ id: 'i', itemText: text, meetingDate });

describe('disqualification thresholds (not reporting thresholds)', () => {
  it('uses the gift limit for the decision year', () => {
    expect(giftLimitForYear(2019)).toBe(500);
    expect(giftLimitForYear(2024)).toBe(590);
    expect(giftLimitForYear(2026)).toBe(630);
    expect(meetsAmountThreshold('D', '$125', { year: 2019 })).toBe(false);
    expect(meetsAmountThreshold('D', '$630', { year: 2026 })).toBe(true);
    expect(meetsAmountThreshold('C', '$500 - $1,000')).toBe(true);
  });

  it('adds gifts from the same source on one statement before applying the limit', async () => {
    const gift = { politician_id: 'p', source_name: 'Sonoma County Farm Bureau', schedule_type: 'D', amount: '125' };
    const text = 'Proclamation honoring the Sonoma County Farm Bureau';
    expect(await detectIncomeGiftsTravel([gift], item(text))).toHaveLength(0);
    expect(await detectIncomeGiftsTravel([{ ...gift, aggregate_amount: 625 }], item(text))).toHaveLength(1);
  });

  it('never treats government salary or stipends as a source of income', async () => {
    expect(isGovernmentSource('Metropolitan Transportation Commission')).toBe(true);
    expect(isGovernmentSource('Sonoma-Marin Area Rail Transit')).toBe(true);
    expect(isGovernmentSource('LandPaths')).toBe(false);
    const stipend = { politician_id: 'p', source_name: 'Metropolitan Transportation Commission', schedule_type: 'C', amount: '$10,001 - $100,000' };
    expect(await detectIncomeGiftsTravel([stipend], item('Appoint a Metropolitan Transportation Commission delegate'))).toHaveLength(0);
  });
});

describe('false-positive guards', () => {
  it('does not match one-word names fuzzily (Cisco is not Francisco)', () => {
    expect(scoreEntityInText('CISCO', 'Contract with the City and County of San Francisco')).toBe(0);
    expect(scoreEntityInText('Cisco', 'Purchase Cisco network switches')).toBe(1);
  });

  it('does not treat "Sonoma County" as the city of Sonoma or scan whole staff reports for land-use words', async () => {
    const property = { politician_id: 'p', property_description: '406 Haraszthy Dr', city: 'Sonoma', fair_market_value: '$100,001 - $1,000,000' };
    const staffReport = 'Title:\nAuthorize Sonoma County Library budget\nRecommended Action:\nApprove the budget.\nDiscussion:\nThe development of the City of Sonoma branch parcel continues.';
    expect(decisionText({ title: 'Library budget', itemText: staffReport })).not.toContain('development');
    expect(await detectRealEstate([property], { id: 'x', title: 'Library budget', itemText: staffReport })).toHaveLength(0);
    const zoning = { id: 'y', title: 'Zoning variance for a parcel in Sonoma', itemText: '' };
    // A city name alone matches every land-use item in that city; only the opt-in research mode uses it.
    expect(await detectRealEstate([property], zoning)).toHaveLength(0);
    expect(await detectRealEstate([property], zoning, { matchCity: true })).toHaveLength(1);
    expect(await detectRealEstate([property], { id: 'z', title: 'Hearing', itemText: 'Staff visited 406 Haraszthy Drive.' })).toHaveLength(1);
  });
});

describe('related-name and self-name guards', () => {
  it('does not turn fair-market-value suffixes into "000" names', () => {
    const related = relatedNamesFromDetails([{ label: 'INVESTMENT — BUSINESS ENTITY/NAME', value: "Gloeckner-Westphall Lease - Fair Market Value - 10,001 - 100,000; Julie's Ranch Lease - Fair Market Value - 10,001 - 100,000; 13425 Rockpile Rd - Fair Market Value - 2,000 - 10,000" }]);
    expect(related.map(({ name }) => name)).toEqual(['Gloeckner-Westphall Lease', "Julie's Ranch Lease", '13425 Rockpile Rd']);
  });

  it('treats the filer\'s own name as not an outside source', () => {
    expect(isFilerOwnName('James Gore', 'James M Gore')).toBe(true);
    expect(isFilerOwnName('Elizabeth Gore', 'James M Gore')).toBe(false);
    expect(isFilerOwnName('LandPaths', 'Lynda Hopkins')).toBe(false);
  });

  it('excludes transportation districts as government income', () => {
    expect(isGovernmentSource('Golden Gate Bridge Highway Transportation District')).toBe(true);
  });
});
