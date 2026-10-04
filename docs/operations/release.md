# Release verification and gates

The repository includes a working release candidate, reproducible build instructions, automated checks, container packaging, migrations and runbooks. **A deployment blueprint is not evidence of a live production deployment.** See [verification report](verification-report.md) for checks actually run in this workspace.

## Required automated evidence

Run the frozen installation, formatting, lint, TypeScript, unit/property tests, real PostgreSQL/API integration suite, production build, browser suite, dependency audit, secret scan, application SAST, all four API/web/database/proxy image scans, and SBOM generation. Include upstream compression tests and the guarded synthetic gzip recovery check when updating the database runtime. The CI workflow pins actions/scanner images and defines Chromium/Firefox/WebKit checks, but adding a workflow does not mean it has run remotely.

Use separate synthetic database/browser fixtures. Do not enable screenshots, videos, traces, request-body logs or failure dumps against real vaults. CI uploads the dependency inventory only. Record tool versions, lock hash, image IDs, test counts, scanner advisory timestamp/coverage, limitations and dispositions. Our six custom Semgrep rules catch selected dangerous patterns; a clean result is not exhaustive OWASP verification.

## Human and external release gates

- Independent cryptographic/protocol review and application penetration testing, including compromised-relay, malicious-current-member, migration, rotation/crash, WebAuthn challenge/session, and verifier cross-tenant/KMS cases.
- Real platform and roaming passkeys, at least two independent passkeys per test account, cross-device ceremonies, lost-device/revocation, expired/failed pairing, and restored-backup checks at the final HTTPS domain.
- Recorded Chromium, Firefox and WebKit/iOS/Android browser matrix, camera/clipboard/storage denial, private mode, low memory, high zoom, forced colors, reduced motion, keyboard-only and screen-reader checks. Review all localized protection messages with native readers.
- Real AWS KMS workload identity and least privilege, context binding, denial and outage behavior, encrypted backups and old KMS ciphertext recovery if the verifier is enabled.
- Final-domain TLS/headers/cookie verification, private backend reachability, edge/global registration and capacity limits, host updates, disk/backup monitoring, encrypted off-host database backups, measured disaster drill and rollback compatibility.
- Review resolved runtime licenses, bundled framework notices and GPL distribution obligations; provide an actual private security contact, disclosure procedure, hosted privacy/retention policy and incident ownership.
- Review the pinned upstream compression snapshot and source/hash evidence; replace temporary local packaging with an official fixed distribution release when available. Review every remaining medium image finding rather than treating the high-severity threshold as a zero-vulnerability claim.
- Operate a reviewed immutable image/provenance/signing release pipeline. Enforce key write/epoch budgets before high-volume use; random GCM nonces do not provide an unlimited distributed-use guarantee.

Owners should mark a gate complete only with attached evidence and date. No generated checklist, green local suite, or newer hash algorithm substitutes for these checks.
