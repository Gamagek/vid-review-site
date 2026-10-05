ALTER TABLE videos ADD COLUMN source_page_url TEXT;

ALTER TABLE videos ADD COLUMN redistribution_certified INTEGER NOT NULL DEFAULT 0
  CHECK (redistribution_certified IN (0, 1));

ALTER TABLE videos ADD COLUMN redistribution_certified_at TEXT;
