# Development and production deployment

## Local development

Use Node 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, then `pnpm dev:all`. The setup script creates a private `.env` if absent and retains an existing file. Its randomly generated database/rate/development-verifier keys are not printed. It enables the development verifier for local tests; `docker compose --profile full` disables it. Do not distribute `.env` or place it in Docker build contexts.

The database binds `127.0.0.1:55432`, API uses 4000, and browser uses **http://localhost:3000**. An API development rewrite keeps browser traffic same-origin. An installed production service worker can cache an older shell while changing build modes: use an isolated development browser profile or unregister that origin's service worker without deleting real vault data.

`pnpm build` produces a static web export and compiled API. `pnpm start` serves the exact generated CSP and local API proxy. `pnpm start:api` loads `.env`. Stop the static server before rebuilding and restart afterward: its CSP is loaded at startup and must match the newly generated HTML.

For the complete local production-mode container stack: `pnpm setup`, then `docker compose --profile full up --build -d --wait`. Migrations run before API startup. API/database ports are not publicly exposed; only the browser endpoint is bound to loopback. Stop with `docker compose --profile full stop`. Do not use `down -v` unless you explicitly intend to delete database data.

## Production preparation

1. Complete the [release gates](release.md). Choose a real dedicated HTTPS domain before enrolling production passkeys; an RP domain change is an account migration, not a cosmetic URL change.
2. Create a private environment file outside the repository with `DOMAIN`, `TLS_CONTACT_EMAIL`, random hex `POSTGRES_PASSWORD` and `RATE_LIMIT_KEY`. Hex avoids unescaped database URL characters. Set `MFA_ENABLED=false` unless the separate verifier is deliberately enabled and reviewed. Use protected secret management/file permissions; never print a resolved Compose configuration containing secrets into CI logs.
3. For the verifier, add `AWS_REGION` and `KMS_KEY_ID` and provision a workload IAM identity. Do not use static AWS credentials in source/images. The provided Compose file does not invent a cloud-specific IAM credential-delivery mechanism; configure your host/orchestrator identity explicitly.
4. Build and scan immutable web/API images, record their image IDs/digests, generate the SBOM, and retain corresponding source/license material. Resolve all high/critical findings or obtain a documented, time-bounded disposition. Node, PostgreSQL and Caddy references are pinned to reviewed digests; refresh those pins deliberately after scanning and testing updates. Record the final application image digests in your release pipeline too.
5. Provision a host with Docker Linux containers, external DNS pointing to it, inbound 80/443 TCP and 443 UDP, outbound certificate access, disk monitoring, encrypted off-host PostgreSQL backups, and an appropriate firewall. Do not publish PostgreSQL or API ports.
6. Start with `docker compose --env-file /private/still-production.env -f infrastructure/compose.production.yml up --build -d --wait`. The one-shot migration service uses the API image and ordered SQL files. It holds a transaction-scoped advisory lock and runs each unapplied version once. Readiness checks expect schema version 4. Back up the database before upgrades.
7. Verify TLS, HSTS, exact Origin/RP ID, cookie flags, API readiness, no public backend ports, no unexpected outbound browser requests, production CSP, and offline installation. Perform the synthetic onboarding/passkey/backup/pairing ceremony at the final domain before inviting users. Hardware and cloud-KMS gates cannot be replaced with localhost tests.

The API and static web runtime use a non-root user, a read-only filesystem, dropped capabilities, no-new-privileges, and health checks. PostgreSQL needs a writable persistent data volume. The database and proxy use the [remediated runtime builds](../security/runtime-remediation.md), preserving compression and TLS trust stores. Caddy runs as UID 10001, obtains TLS certificates, and writes its certificate/configuration volumes; ensure existing volumes have that ownership before upgrading. Access logging is not enabled by default. Static user data never enters the image.

`TRUST_PROXY_HOPS=1` is correct only when the API is reachable through the one trusted reverse-proxy hop shown. Do not expose the API directly or add a load-balancer chain without adjusting and reviewing this policy. The local web proxy overwrites forwarded address headers; production Caddy connects directly to the internal API. Edge rate limits and DDoS controls remain operator responsibilities.

## Configuration and limits

Production refuses HTTP origins, IP relying-party IDs, mismatched Origin/RP domains, missing rate-limit keys, any development verifier key, and an enabled verifier lacking KMS configuration. Set explicit values; the application's localhost defaults are development-only.

Limits include 9,999 local account records, 10,000 cloud record heads, 100,000 operations and approximately 100 MiB serialized history budget per cloud vault, 50 owned cloud vaults per account, and 100 members per shared vault. Rotation consumes history/storage budget too. Exhaustion preserves existing state and requires an operator-supported migration/new vault; no silent history truncation is implemented. The budget counts serialized operations plus overhead, not exact filesystem/database usage; monitor real disk usage separately.

Normal JSON requests are bounded at 1 MiB; rotation at 24 MiB. Imports are 5 MiB/1,000 rows, QR images 10 MiB/16 megapixels, pairing uploads 5 MiB/16 megapixels, and backups 24 MiB. Argon2 imported costs are bounded to prevent uncontrolled memory allocation. Add edge/global registration/storage capacity policies for a public hosted service.

## Operations

Monitor `/api/health/live` and `/api/health/ready`, generic error/status counts, DB capacity, backup completion, API latency, rate-limit saturation, TLS expiry, and KMS availability. Do not enable body/cookie/Authorization logging. Application logs contain only startup and generic cleanup-failure messages; account security events contain fixed types and opaque IDs.

Patch locked dependencies and base images deliberately, rebuild the static CSP/cache manifest, run all gates, and roll out a reviewed release. A waiting service-worker update asks the user to lock before activation. Avoid forced updates while unlocked. This protects against stale UI state, not a malicious signed-in hosting operator.

For an application rollback, preserve the database and use only a version compatible with its forward migrations. Never restore an older API that lacks new integrity/schema checks against newer data. Practice disaster recovery and browser-backup restoration before production launch; runbook instructions are not evidence of a completed drill.
