# Contributing

Use Node 24 and pnpm 11.25.0. Install the frozen lockfile, run `pnpm dev:all`, and use only synthetic seeds/accounts in the development browser and database. Preserve the GPL-2.0-only license.

Before proposing changes, run formatting, lint, types, unit/API tests, build, browser tests, dependency audit, secret/SAST scans, and the SBOM workflow. Explain behavior, validation, and any trust-boundary/protocol/schema change. Test semantic security properties rather than merely duplicating implementation. Keep migrations forward-only and ordered; do not rewrite an applied migration.

Do not add external fonts, analytics, remote issuer assets, raw HTML rendering, weak random generation, plaintext persistence, secret logging, or a local-passphrase reset path. Do not change an existing OTP account's algorithm for marketing reasons. New cryptographic suites require a protocol version, reviewed design, migration path, known vectors, and independent review.

Keep local `.env`, browser profiles, downloaded exports, and generated scan/test artifacts out of version control. A test failure can contain synthetic recovery material; sanitize shared artifacts. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Review changes respectfully, explain disagreements with evidence, avoid personal attacks, and treat security concerns as actionable engineering work. A hosted project's maintainers should publish their moderation contact and policy before accepting a public community.
