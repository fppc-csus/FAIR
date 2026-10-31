-- Additive: existing rows retain unknown ownership and all review/audit fields.
ALTER TABLE "conflicts"
  ADD COLUMN "detection_owner" TEXT,
  ADD COLUMN "eligibility_status" TEXT,
  ADD COLUMN "filing_id" UUID,
  ADD COLUMN "disclosure_id" UUID,
  ADD COLUMN "filing_year" INTEGER,
  ADD COLUMN "jurisdiction_id" UUID,
  ADD COLUMN "meeting_date" TIMESTAMP(3),
  ADD COLUMN "supporting_source" TEXT;
CREATE INDEX "conflicts_detection_owner_agenda_item_id_idx" ON "conflicts"("detection_owner", "agenda_item_id");