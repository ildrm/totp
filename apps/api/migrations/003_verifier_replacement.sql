ALTER TABLE verifier.credentials
  ADD COLUMN replaces_id uuid,
  ADD COLUMN enrollment_expires timestamptz;
UPDATE verifier.credentials SET enrollment_expires=created_at+interval '24 hours' WHERE active=false;
INSERT INTO schema_migrations(version) VALUES(3);
