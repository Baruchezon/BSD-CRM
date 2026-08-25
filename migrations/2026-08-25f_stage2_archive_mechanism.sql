BEGIN;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archive_reason text;

-- Archive the 3 known test records only (already verified zero relations in prior read-only checks).
UPDATE businesses SET is_archived = true, archived_at = now(), archive_reason = 'רשומת בדיקה ללא קשרים - אושר לארכוב 25.08.2026'
WHERE internal_name = 'עסק בדיקה קלוד';

UPDATE leads SET is_archived = true, archived_at = now(), archive_reason = 'רשומת בדיקה ללא קשרים - אושר לארכוב 25.08.2026'
WHERE full_name = 'בדיקה אוטומטית קלוד';

COMMIT;
