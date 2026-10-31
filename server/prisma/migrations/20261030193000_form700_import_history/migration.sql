CREATE TABLE "form700_import_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "original_filename" TEXT NOT NULL,
  "source_digest" TEXT NOT NULL,
  "admin_user_id" TEXT,
  "status" TEXT NOT NULL,
  "imported_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "warnings" JSONB,
  "results" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form700_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form700_import_runs_created_at_idx" ON "form700_import_runs"("created_at" DESC);
CREATE INDEX "form700_import_runs_source_digest_idx" ON "form700_import_runs"("source_digest");