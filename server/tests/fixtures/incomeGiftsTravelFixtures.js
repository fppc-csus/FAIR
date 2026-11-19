export const matchingIncomeSource = {
  politician_id: 1,
  source_name: "Acme Corporation",
  amount: 5000,
  schedule_type: "C",
};

export const matchingIncomeAgendaItem = {
  id: 200,
  item_text: "Approve a contract with Acme Corporation.",
};

export const nonMatchingIncomeAgendaItem = {
  id: 201,
  item_text: "Approve repairs to the city hall parking structure.",
};

export const belowThresholdIncomeSource = {
  politician_id: 1,
  source_name: "Acme Corporation",
  amount: 499,
  schedule_type: "C",
};

export const matchingGiftSource = {
  politician_id: 1,
  source_name: "Downtown Business Association",
  amount: 700,
  schedule_type: "D",
};

export const matchingGiftAgendaItem = {
  id: 202,
  item_text: "Approve funding partnership with Downtown Business Association.",
};

export const matchingTravelSource = {
  politician_id: 1,
  source_name: "Regional Planning Council",
  amount: 750,
  schedule_type: "E",
};

export const matchingTravelAgendaItem = {
  id: 203,
  item_text: "Approve an agreement with the Regional Planning Council.",
};