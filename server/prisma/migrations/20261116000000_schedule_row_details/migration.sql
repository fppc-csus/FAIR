-- Preserve the complete Form 700 source row for each disclosure (addresses,
-- business activity, acquisition/disposal dates, lenders, A-2 income sources,
-- gift descriptions, travel destinations, ...) as ordered label/value pairs.
ALTER TABLE "schedule_a_investments" ADD COLUMN "details" JSONB;
ALTER TABLE "schedule_b_realestate" ADD COLUMN "details" JSONB;
ALTER TABLE "schedule_cde_income" ADD COLUMN "details" JSONB;
ALTER TABLE "schedule_a2_business_positions" ADD COLUMN "details" JSONB;
