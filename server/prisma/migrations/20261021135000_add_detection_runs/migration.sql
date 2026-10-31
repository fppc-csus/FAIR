CREATE TABLE "detection_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "filing_id" UUID,
  "politician_id" UUID,
  "jurisdiction_id" UUID,
  "filing_year" INTEGER NOT NULL,
  "trigger" TEXT NOT NULL,
  "triggered_by" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "total_items" INTEGER NOT NULL DEFAULT 0,
  "processed_items" INTEGER NOT NULL DEFAULT 0,
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "lock_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "detection_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "detection_runs_filing_id_fkey"
    FOREIGN KEY ("filing_id") REFERENCES "form700_filings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "detection_runs_politician_id_fkey"
    FOREIGN KEY ("politician_id") REFERENCES "politicians"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "detection_runs_jurisdiction_id_fkey"
    FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "detection_runs_status_created_at_idx"
  ON "detection_runs"("status", "created_at");
CREATE INDEX "detection_runs_filing_id_idx"
  ON "detection_runs"("filing_id");
CREATE INDEX "detection_runs_jurisdiction_year_idx"
  ON "detection_runs"("jurisdiction_id", "filing_year");

CREATE TABLE "detection_run_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "detection_run_id" UUID NOT NULL,
  "agenda_item_id" UUID NOT NULL,
  "politician_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "detection_run_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "detection_run_items_run_fkey"
    FOREIGN KEY ("detection_run_id") REFERENCES "detection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "detection_run_items_agenda_item_fkey"
    FOREIGN KEY ("agenda_item_id") REFERENCES "agenda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "detection_run_items_politician_fkey"
    FOREIGN KEY ("politician_id") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "detection_run_items_identity_key"
  ON "detection_run_items"("detection_run_id", "agenda_item_id", "politician_id");
CREATE INDEX "detection_run_items_run_status_idx"
  ON "detection_run_items"("detection_run_id", "status");
CREATE INDEX "detection_run_items_agenda_item_id_idx"
  ON "detection_run_items"("agenda_item_id");
