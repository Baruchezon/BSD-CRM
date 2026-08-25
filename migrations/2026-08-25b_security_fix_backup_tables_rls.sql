BEGIN;

ALTER TABLE businesses_backup_20260825 ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads_backup_20260825 ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_number_correction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_number_correction_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON businesses_backup_20260825 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON leads_backup_20260825 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON business_number_correction_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON client_number_correction_log FROM PUBLIC, anon, authenticated;

COMMIT;
