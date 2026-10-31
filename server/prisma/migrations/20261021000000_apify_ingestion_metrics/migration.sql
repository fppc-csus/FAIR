ALTER TABLE "data_sources"
  ADD COLUMN "last_documents_found" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_pdfs_fetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_items_inserted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_items_skipped" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_sync_errors" JSONB;

ALTER TABLE "sync_logs"
  ADD COLUMN "documents_found" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pdfs_fetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "documents_skipped" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "agenda_items"
  ADD COLUMN "source_url" TEXT;
