-- Preserve pre-release history for audit; only authenticated operations are served by v1.
ALTER TABLE sync_operations ADD COLUMN proof jsonb;
INSERT INTO schema_migrations(version) VALUES(2);
