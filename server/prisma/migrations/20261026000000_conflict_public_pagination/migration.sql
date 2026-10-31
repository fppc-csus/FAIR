-- Stable pagination and equality-filtered chronological browsing.
CREATE INDEX "conflicts_detected_id_idx" ON "conflicts" ("detected_at" DESC, "id" ASC);
CREATE INDEX "conflicts_review_detected_id_idx" ON "conflicts" ("review_status", "detected_at" DESC, "id" ASC);
CREATE INDEX "conflicts_type_detected_id_idx" ON "conflicts" ("conflict_type", "detected_at" DESC, "id" ASC);
-- Prisma cannot express CASE-based indexes; retained as application-owned SQL.
CREATE INDEX "conflicts_severity_rank_detected_id_idx" ON "conflicts" ((CASE UPPER(severity) WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END) DESC, detected_at DESC, id ASC);
