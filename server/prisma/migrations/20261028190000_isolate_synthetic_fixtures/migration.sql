ALTER TABLE "politicians" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agenda_items" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- Preserve existing foreign keys while namespacing pre-existing Legistar IDs.
-- Refuse ambiguous ownership rather than guessing which client owns a row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM agenda_items a
    WHERE a.source_type = 'legistar' AND a.legistar_item_id ~ '^[0-9]+$'
    AND (SELECT count(DISTINCT lower(trim(trailing '/' FROM s.legistar_base_url)))
         FROM data_sources s WHERE lower(s.source_type) = 'legistar'
         AND lower(s.city_name) = lower(a.city_name)) <> 1
  ) THEN
    RAISE EXCEPTION 'Cannot namespace legacy Legistar IDs: missing or ambiguous data source';
  END IF;
END $$;

UPDATE agenda_items a
SET legistar_item_id = lower(substring(trim(trailing '/' FROM s.legistar_base_url) from '[^/]+$')) || ':' || a.legistar_item_id,
    city_id = s.id::text
FROM data_sources s
WHERE a.source_type = 'legistar' AND a.legistar_item_id ~ '^[0-9]+$'
  AND lower(s.source_type) = 'legistar' AND lower(s.city_name) = lower(a.city_name);