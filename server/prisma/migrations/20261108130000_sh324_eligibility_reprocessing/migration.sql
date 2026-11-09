ALTER TABLE "detection_runs" ADD COLUMN "agenda_item_id" UUID;
CREATE INDEX "detection_runs_agenda_item_id_idx" ON "detection_runs"("agenda_item_id");