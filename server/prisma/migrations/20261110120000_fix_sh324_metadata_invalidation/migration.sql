-- A shared trigger must branch by table before accessing table-specific OLD/NEW
-- fields: PostgreSQL may evaluate an AND operand referencing a missing field.
CREATE OR REPLACE FUNCTION invalidate_eligibility_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'politicians' THEN
    IF OLD.jurisdiction_id IS DISTINCT FROM NEW.jurisdiction_id
       OR (OLD.needs_review = false AND NEW.needs_review = true) THEN
      IF OLD.jurisdiction_verified_at IS NOT NULL THEN
        INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
        VALUES ('politician', OLD.id, 'invalidated', OLD.jurisdiction_verified_id::text);
      END IF;
      NEW.jurisdiction_verified_id := NULL;
      NEW.jurisdiction_verified_at := NULL;
      NEW.jurisdiction_verified_by := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'form700_filings' THEN
    IF OLD.filing_year IS DISTINCT FROM NEW.filing_year THEN
      IF OLD.filing_year_verified_at IS NOT NULL THEN
        INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
        VALUES ('filing', OLD.id, 'invalidated', OLD.filing_year_verified_value::text);
      END IF;
      NEW.filing_year_verified_value := NULL;
      NEW.filing_year_verified_at := NULL;
      NEW.filing_year_verified_by := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'agenda_items' THEN
    IF OLD.meeting_date IS DISTINCT FROM NEW.meeting_date OR OLD.meeting_id IS DISTINCT FROM NEW.meeting_id THEN
      IF OLD.meeting_date_verified_at IS NOT NULL THEN
        INSERT INTO eligibility_verification_events (record_type, record_id, action, value)
        VALUES ('agenda', OLD.id, 'invalidated', OLD.meeting_date_verified_value::text);
      END IF;
      NEW.meeting_date_verified_value := NULL;
      NEW.meeting_date_verified_at := NULL;
      NEW.meeting_date_verified_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;