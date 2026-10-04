# Still · a local-first authenticator

Still is an offline-capable TOTP/HOTP vault with a browser worker that holds unlocked keys, encrypted IndexedDB storage, recoverable encrypted backups, optional passkey accounts and end-to-end encrypted synchronization. An optional developer MFA verifier has a **separate, server-readable trust model**.

The interface includes mobile layouts, light/dark themes, privacy mode, keyboard navigation, RTL support, QR scanning, import previews, account organization, and shared-vault membership and key rotation.

**Release status:** implemented release candidate. Passing automated checks does not establish an independent security audit or certify every browser, authenticator, accessibility scenario, or production deployment. See [release gates](docs/operations/release.md) and [scope and coverage](docs/requirements-coverage.md) before handling real secrets.

## Start locally

Prerequisites: Node.js 24, pnpm 11.25.0, and Docker with Linux containers. Dependencies are locked in `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev:all
```

Open **http://localhost:3000**. The command generates private local configuration if absent, starts PostgreSQL, applies ordered migrations, and starts both development processes. Use `localhost` for WebAuthn: an IP address is not a valid relying-party domain. Keep `.env` private.

For production-mode local containers:

```sh
pnpm setup
docker compose --profile full up --build -d --wait
```

This runs the static production web build, migration job, API, and database on loopback. The optional verifier is disabled in that profile. Cloud functions need the API; local OTP generation does not.

## Security choices

| Purpose                   | Choice                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Existing OTP accounts     | Preserve the issuer's HMAC-SHA-1, SHA-256, or SHA-512 parameters                             |
| New verifier credentials  | HMAC-SHA-256, random 256-bit seed, 8 digits, 30-second TOTP; SHA-512 supported               |
| Vault encryption          | AES-256-GCM, independent random vault keys, authenticated context and metadata               |
| Passphrase protection     | Argon2id, 64 MiB, 3 iterations, parallelism 1; bounded imported costs                        |
| Recovery                  | Independent random 256-bit recovery material and HKDF-SHA-512 key wrapping                   |
| Device pairing            | Ephemeral P-256 ECDH, domain-bound HKDF-SHA-256, AES-GCM, out-of-band fingerprint comparison |
| Cloud login               | User-verified resident WebAuthn passkeys, opaque server sessions                             |
| Optional verifier storage | AWS KMS in production; development key forbidden in production                               |

SHA3, SHAKE, BLAKE2, BLAKE3, and KMAC were evaluated in the [cryptography decision](docs/adr/001-cryptographic-suites.md). They are not interchangeable with standard OTP algorithms. Stronger hashes alone do not fix short-code guessing, phishing, replay, weak passphrases, or compromised client software.

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm start:api
# In another terminal, with the migrated local database and API running:
pnpm test
pnpm test:e2e
pnpm security:audit
pnpm security:sbom
# After building still-api:release, still-web:release and still-database:release:
pnpm test:containers
```

The integration suite uses only generated fixture accounts in the configured database and requires the API. Set `MFA_ENABLED=true` in the **development** `.env` to include verifier integration tests; the setup script generates its development-only key. Browser tests use installed Chrome locally and Chromium/Firefox/WebKit in CI. Never point tests at a live production database or a real account profile.

## Documentation

- [Optimized implementation prompt](docs/optimized-implementation-prompt.md) and [requirements coverage](docs/requirements-coverage.md)
- [User guide](docs/user-guide.md), [roles and interface design](docs/design/roles-and-flows.md), [browser capabilities](docs/security/browser-capabilities.md)
- [Architecture](docs/architecture/overview.md), [vault format](docs/protocols/vault-format.md), [sync and pairing](docs/protocols/sync-and-pairing.md)
- [Threat model](docs/security/threat-model.md), [privacy inventory](docs/security/privacy.md), [dependency inventory](docs/security/dependency-inventory.md)
- [Runtime image remediation and source provenance](docs/security/runtime-remediation.md)
- [Developer MFA API](docs/api/mfa-verifier.md)
- [Deployment](docs/operations/deployment.md), [backup and incident response](docs/operations/recovery-and-incidents.md), [verified results](docs/operations/verification-report.md), [release gates](docs/operations/release.md)
- [Security reporting](SECURITY.md) and [contributing](CONTRIBUTING.md)

The existing GPL-2.0-only [LICENSE](LICENSE) is preserved. Review bundled dependency licenses and distribution obligations before distributing images or browser bundles.
