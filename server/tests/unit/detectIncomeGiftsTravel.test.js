import { describe, it, expect } from "vitest";
import { detectIncomeGiftsTravel } from "../../src/detection/detectIncomeGiftsTravel.js";
import { CONFLICT_TYPES } from "../../src/config/conflictRules.js";

const politicianId = "pol-cde-1";
const agendaItemId = "item-cde-1";

const acmeIncome = {
  politician_id: politicianId,
  source_name: "Acme Builders",
  amount: "$2,500",
  schedule_type: "C",
};

describe("detectIncomeGiftsTravel", () => {
  it("flags when the source name appears in the agenda item", async () => {
    const item = {
      id: agendaItemId,
      title: "Award sidewalk contract to Acme Builders",
      description: "Construction services for downtown.",
    };

    const flags = await detectIncomeGiftsTravel([acmeIncome], item);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: CONFLICT_TYPES.INCOME,
      entity_name: "Acme Builders",
    });
    expect(flags[0].rule_reference).toMatch(/§87103/);
  });

  it("does not flag when the source is not mentioned", async () => {
    const item = {
      id: agendaItemId,
      title: "Approve minutes of the prior meeting",
      description: "No contracts on this item.",
    };

    const flags = await detectIncomeGiftsTravel([acmeIncome], item);
    expect(flags).toHaveLength(0);
  });

  it("does not flag amounts below the schedule threshold", async () => {
    const item = {
      id: agendaItemId,
      title: "Thank Acme Builders for community work",
      description: "Recognition item.",
    };

    const belowIncome = await detectIncomeGiftsTravel(
      [{ ...acmeIncome, amount: "$100" }],
      item,
    );
    expect(belowIncome).toHaveLength(0);

    const belowGift = await detectIncomeGiftsTravel(
      [{ ...acmeIncome, schedule_type: "D", amount: "$25" }],
      item,
    );
    expect(belowGift).toHaveLength(0);

    const belowTravel = await detectIncomeGiftsTravel(
      [{ ...acmeIncome, schedule_type: "E", amount: "$40" }],
      item,
    );
    expect(belowTravel).toHaveLength(0);
  });

  it("emits GIFT and TRAVEL from schedule_type when the source is named", async () => {
    const item = {
      id: agendaItemId,
      title: "Discussion of travel hosted by Acme Builders",
      item_text: "Acme Builders sponsored the conference.",
    };

    const gift = await detectIncomeGiftsTravel(
      [{ ...acmeIncome, schedule_type: "D", amount: "$700" }],
      item,
    );
    expect(gift[0].conflict_type).toBe(CONFLICT_TYPES.GIFT);

    const travel = await detectIncomeGiftsTravel(
      [{ ...acmeIncome, schedule_type: "E", amount: "$650" }],
      item,
    );
    expect(travel[0].conflict_type).toBe(CONFLICT_TYPES.TRAVEL);
  });
});
