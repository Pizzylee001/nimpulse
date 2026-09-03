-- Phase 2b: price provenance. Records which real source provided the
-- open and close prices for a resolved question.
ALTER TABLE questions ADD COLUMN price_source TEXT;
