BEGIN;

-- Safe: verified 0 active businesses/leads without a number before adding this constraint.
ALTER TABLE businesses ADD CONSTRAINT business_number_required_if_active
  CHECK (is_archived OR business_number IS NOT NULL);

ALTER TABLE leads ADD CONSTRAINT client_number_required_if_active
  CHECK (type NOT IN ('buyer','partner') OR is_archived OR client_number IS NOT NULL);

COMMIT;
