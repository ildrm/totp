-- Allow a pending replacement while keeping at most one active factor per subject/application.
ALTER TABLE verifier.credentials DROP CONSTRAINT credentials_application_id_subject_hash_key;
CREATE UNIQUE INDEX credentials_active_subject ON verifier.credentials(application_id,subject_hash) WHERE active=true;
CREATE INDEX credentials_subject ON verifier.credentials(application_id,subject_hash);

ALTER TABLE vaults ADD COLUMN storage_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_bytes>=0);
UPDATE vaults v SET storage_bytes=COALESCE((SELECT sum(octet_length(COALESCE(envelope::text,''))+octet_length(COALESCE(proof::text,''))+256) FROM sync_operations o WHERE o.vault_id=v.id),0);
INSERT INTO schema_migrations(version) VALUES(4);
