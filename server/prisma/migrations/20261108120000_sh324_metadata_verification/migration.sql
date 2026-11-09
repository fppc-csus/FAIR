ALTER TABLE "politicians" ADD COLUMN "jurisdiction_verified_id" UUID, ADD COLUMN "jurisdiction_verified_at" TIMESTAMPTZ(3), ADD COLUMN "jurisdiction_verified_by" TEXT;
ALTER TABLE "form700_filings" ADD COLUMN "filing_year_verified_value" INTEGER, ADD COLUMN "filing_year_verified_at" TIMESTAMPTZ(3), ADD COLUMN "filing_year_verified_by" TEXT;
ALTER TABLE "agenda_items" ADD COLUMN "meeting_date_verified_value" TIMESTAMP(3), ADD COLUMN "meeting_date_verified_at" TIMESTAMPTZ(3), ADD COLUMN "meeting_date_verified_by" TEXT;
ALTER TABLE "conflicts" ADD COLUMN "politician_jurisdiction_id" UUID;

CREATE TABLE "eligibility_verification_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "record_type" TEXT NOT NULL,
  "record_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "value" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "eligibility_verification_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eligibility_verification_events_record_idx"
  ON "eligibility_verification_events" ("record_type", "record_id", "created_at");
ALTER TABLE "eligibility_verification_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "eligibility_verification_events" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "eligibility_verification_events" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "eligibility_verification_events" FROM authenticated;
  END IF;
END $$;

-- All write paths, including raw SQL ingestion, must invalidate confirmations.
-- Reset all three fields so returning to a previously verified value cannot
-- silently revive an earlier confirmation. The audit row survives deletion.
CREATE FUNCTION invalidate_eligibility_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_value text;
BEGIN
  IF TG_TABLE_NAME = 'politicians' AND (OLD.jurisdiction_id IS DISTINCT FROM NEW.jurisdiction_id
      OR (OLD.needs_review = false AND NEW.needs_review = true)) THEN
    old_value := OLD.jurisdiction_verified_id::text;
    IF OLD.jurisdiction_verified_at IS NOT NULL THEN
      INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
      VALUES ('politician', OLD.id, 'invalidated', old_value);
    END IF;
    NEW.jurisdiction_verified_id := NULL;
    NEW.jurisdiction_verified_at := NULL;
    NEW.jurisdiction_verified_by := NULL;
  ELSIF TG_TABLE_NAME = 'form700_filings' AND OLD.filing_year IS DISTINCT FROM NEW.filing_year THEN
    old_value := OLD.filing_year_verified_value::text;
    IF OLD.filing_year_verified_at IS NOT NULL THEN
      INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
      VALUES ('filing', OLD.id, 'invalidated', old_value);
    END IF;
    NEW.filing_year_verified_value := NULL;
    NEW.filing_year_verified_at := NULL;
    NEW.filing_year_verified_by := NULL;
  ELSIF TG_TABLE_NAME = 'agenda_items' AND (OLD.meeting_date IS DISTINCT FROM NEW.meeting_date OR OLD.meeting_id IS DISTINCT FROM NEW.meeting_id) THEN
    old_value := OLD.meeting_date_verified_value::text;
    IF OLD.meeting_date_verified_at IS NOT NULL THEN
      INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
      VALUES ('agenda', OLD.id, 'invalidated', old_value);
    END IF;
    NEW.meeting_date_verified_value := NULL;
    NEW.meeting_date_verified_at := NULL;
    NEW.meeting_date_verified_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER politician_eligibility_invalidation BEFORE UPDATE OF jurisdiction_id, needs_review ON politicians
  FOR EACH ROW EXECUTE FUNCTION invalidate_eligibility_metadata();
CREATE TRIGGER filing_eligibility_invalidation BEFORE UPDATE OF filing_year ON form700_filings
  FOR EACH ROW EXECUTE FUNCTION invalidate_eligibility_metadata();
CREATE TRIGGER agenda_eligibility_invalidation BEFORE UPDATE OF meeting_date, meeting_id ON agenda_items
  FOR EACH ROW EXECUTE FUNCTION invalidate_eligibility_metadata();

CREATE FUNCTION invalidate_linked_agenda_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.meeting_date IS DISTINCT FROM NEW.meeting_date THEN
    INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
      SELECT 'agenda', id, 'invalidated', meeting_date_verified_value::text
      FROM agenda_items WHERE meeting_id = NEW.id AND meeting_date_verified_at IS NOT NULL;
    UPDATE agenda_items SET meeting_date_verified_value = NULL,
      meeting_date_verified_at = NULL, meeting_date_verified_by = NULL
      WHERE meeting_id = NEW.id AND meeting_date_verified_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meeting_eligibility_invalidation AFTER UPDATE OF meeting_date ON meetings
  FOR EACH ROW EXECUTE FUNCTION invalidate_linked_agenda_dates();