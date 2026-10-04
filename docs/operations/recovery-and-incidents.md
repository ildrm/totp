# Backups, recovery, and incidents

## Consumer recovery

Keep encrypted `.otpvault` files off the browser device and keep the independent recovery kit in a separate offline location. Verify a test restore in an isolated profile using synthetic accounts before relying on this process. Recover the actual vault with its backup passphrase or recovery key. If the original browser still contains data, export or quarantine it first. Restore authenticates all records before replacing that vault and preserves other local vaults.

Changing a passphrase rewraps the existing VEK; old backups still use the old passphrase. Rotating the VEK changes the key epoch and generates new recovery material. Back up immediately afterward and re-pair remaining trusted devices. An encrypted cached rotation preparation supports resuming a server-committed rotation after a local crash, after confirming the expected new key ID. Do not delete that browser's pending encrypted state while investigating a failed rotation.

Loss of every passkey prevents cloud account access; there is no password/email bypass. Multiple independent passkeys and local encrypted backups are the recovery strategy. Loss of all encrypted data or all applicable key material is irrecoverable. Operators cannot decrypt consumer vaults to fix it.

## Database disaster recovery

The operator must schedule encrypted PostgreSQL logical/physical backups with an off-host copy and an explicit retention/RPO/RTO policy. Database backups contain encrypted consumer records, opaque identity metadata, passkey public keys, session hashes, and server-encrypted verifier records. Protect them as sensitive data even without consumer VEKs.

Practice the drill on a separate network and fresh database volume:

1. Record software/image digests, schema version, backup timestamp, expected users/vaults and synthetic record checksums. Back up verifier KMS configuration/IAM policy references without exporting consumer keys or placing cloud credentials in the dump.
2. Restore PostgreSQL into the isolated environment using its supported tools. Start the matching migration/API version, confirm readiness and integrity checks, and ensure migration re-runs skip already applied versions.
3. Invalidate restored sessions and challenge rows before admitting traffic; review whether restored security events/counters require additional replay safeguards. Never replay real users' verifier tests merely to check the backup.
4. Test synthetic passkey login, ciphertext-only sync, a local encrypted backup restore, shared-member authorization, and verifier behavior under permitted/denied KMS identities. Confirm KMS key access and historical ciphertext recovery before retiring any KMS key.
5. Record measured data loss and recovery time. Restore production routing only after security ownership and database state are verified. Keep the failed data volume for restricted investigation; avoid destructive cleanup during recovery.

The workspace verified a guarded synthetic gzip backup/atomic-restore round trip followed by API/browser tests; see the [verification report](verification-report.md). This tests tool compatibility and fixture integrity. The off-host encryption, session invalidation, KMS, real workload and measured recovery-time steps above remain operator release gates.

## Incident response

For stolen cloud sessions/devices, revoke the affected device or all sessions using a trusted passkey; then assess shared access and rotate affected vault keys. For disclosed OTP seeds, re-enroll factors at the original issuers: changing a vault passphrase does not rotate third-party OTP seeds. For a compromised shared member, remove membership and rotate; assume prior shared seeds were copied and rotate them at their issuers where required.

For verifier API-key disclosure, revoke the key, issue a scoped replacement, inspect minimal metadata, and review application access. For verifier seed/KMS compromise, disable affected factors and use two-phase replacement only after the host/KMS trust boundary is restored. Do not confuse consumer E2EE with verifier compromise protection.

For a suspected malicious client/dependency release, halt distribution and updates, preserve build/SBOM/image evidence, publish a reviewed clean release, and require issuer-side seed rotation where unlocked vault exposure is plausible. Revoking server sessions alone cannot undo browser seed theft.

Report only software version, generic error category, timestamps, affected opaque IDs through an approved private channel, and synthetic reproduction steps. Never request user vault files, recovery material, provisioning URIs, OTPs, passkey private material, API keys, cookies, or full storage dumps. Establish a real private security contact and coordinated disclosure procedure before a public service launch.
