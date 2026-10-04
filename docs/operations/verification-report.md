# Workspace verification — 4–5 October 2026

This report records observed checks, not an independent audit. The release status remains **candidate** until the [production release gates](release.md) have evidence. The [coverage matrix](../requirements-coverage.md) lists implemented features and remaining scope.

| Check                           | Observed result                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                      | Strict web/core and API checks pass                                                                                                                         |
| ESLint                          | Pass, zero errors or warnings                                                                                                                               |
| Formatting                      | Pass; generated Next environment declarations are excluded                                                                                                  |
| Production build                | Next static export, local worker, CSP/cache generation and compiled Nest API pass                                                                           |
| Unit/property/API suite         | 96 tests across six files, including 15 real PostgreSQL/API integration cases; final run against patched/restored database passes                           |
| Browser functional suite        | All 15 installed-Chrome tests pass against local builds and packaged containers; final run after database remediation: 58.6 seconds                         |
| Shared browser ceremony         | Two isolated virtual-passkey accounts complete membership, fingerprint comparison, encrypted key transfer, ciphertext sync, and personal-vault preservation |
| Seed reveal                     | Reauthentication, local QR display, and clearing on lock pass                                                                                               |
| Accessibility                   | Axe checks pass for tested onboarding, add-account dialog and dashboard states; mobile RTL overflow check passes                                            |
| Visual review                   | Desktop and mobile screenshots inspected using only public RFC fixtures                                                                                     |
| Dependency audit                | Final installed production dependencies: no known advisories reported by pnpm audit                                                                         |
| Secret scan                     | Digest-pinned Gitleaks: no leaks in staged source; private configuration/build/browser state excluded                                                       |
| Application SAST                | Six custom Semgrep rules, 56 TypeScript/JavaScript application and script targets, approximately 99.9% parsed lines: zero findings                          |
| Dependency inventory            | CycloneDX 1.6 artifact and declared-license inventory generated, 294 resolved npm runtime components including optional platform variants                   |
| Runtime image scans             | All four final API/web/database/proxy images pass the high-severity gate; medium findings remain below                                                      |
| Upstream compression tests      | Static, shared-library and 64-bit zlib test targets pass in the database build                                                                              |
| Fresh installation              | Separate PostgreSQL fixture volume; all four migrations, idempotent rerun, API UID 1000, all 96 unit/API and 15 browser tests pass                          |
| Database recovery fixture       | Gzip logical backup, atomic restore, marker integrity, schema-version checks and subsequent migration/API/browser checks pass                               |
| Proxy restrictions              | UID 10001, read-only root filesystem, no capabilities; writable certificate/configuration volumes and synthetic local-CA HTTPS response verified            |
| Production configuration        | Compose validates with synthetic values; pinned-base Caddy configuration validates offline without formatting warnings                                      |
| CI / other browsers             | Workflow supplied for Chromium/Firefox/WebKit and all four image scans; remote CI execution and non-Chrome/hardware evidence are not claimed                |
| Real production HTTPS/KMS/audit | Not performed: final-domain certificate/routing, operator workload identity/KMS, hardware and independent review remain gates                               |

## Final runtime image evidence

Grype **0.120.0** used a valid schema **v6.1.10** advisory database built **2026-10-04T08:11:47Z**. Its downloaded archive was verified against the public catalog SHA-256 before offline import. Final scans ran with networking disabled, a read-only advisory cache, and no Docker-daemon access. Raw reports are under ignored `artifacts/scans/`.

| Final image              | Scanned image configuration ID                                            | Raw result                |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------- |
| `still-api:release`      | `sha256:27c8d283d99d1c69f12df289114ef579bdfdc5dea9a0ca344a6ae8d85e1f74e3` | 0 high/critical, 2 medium |
| `still-web:release`      | `sha256:56494e3cdeb1dfe3e80d91c4a921764b01a0b4a7464a8a5f2850ce3dbc8ad292` | 0 high/critical, 2 medium |
| `still-database:release` | `sha256:df6ef55de8e167046cc80b87f37d6301c4b41105002f2a4ca87adc052bfb439c` | 0 high/critical, 3 medium |
| `still-proxy:release`    | `sha256:bb8d95a1a448f2c83411264ef0fde9c02adc02c6117afb6d70e68a5ba62cc904` | 0 high/critical, 2 medium |

The remaining entries are **CVE-2025-60876** in BusyBox/busybox-binsh, plus ssl_client in the database image. Versions are 1.37.0-r31 in API/web/database and 1.37.0-r30 in the proxy. These are nine package/image entries for that advisory, not nine independently discovered vulnerabilities. No suppression or vulnerability-ignore file hides them. Release owners must review exposure and updates; passing the high-severity gate does not mean zero vulnerabilities.

## Remediation and limits

The package audit did not cover npm/yarn bundled into the Node image. Initial runtime scans reported high findings in unused package-manager dependencies and system zlib. API/web remove those unused components. The proxy preserves its TLS trust store while removing unused curl/package-manager dependencies and its file capability, then runs without root privileges.

PostgreSQL preserves compression capability through the checksum-pinned upstream **1.3.2.1-motley** snapshot containing the gzip fix, packaged accurately as a local replacement. Source/hash labels, package metadata and its license notice remain in the image. See [runtime remediation](../security/runtime-remediation.md) for provenance and maintenance obligations. Alternative unmodified Debian/older Alpine images were scanned and rejected rather than adopted merely to change the scan result. Independent snapshot review and eventual adoption of an official fixed distribution package remain release obligations.

Node's observed dynamic dependencies are musl, libstdc++ and libgcc. Its bundled TLS/compression implementation still follows Node's upstream security lifecycle; removing a separate system package is not a claim about every embedded library. The npm inventory covers resolved application packages, not a complete legal review of framework bundles and OS components.

Scanners cover selected source patterns, known advisories and the specific scanned images. They do not prove resistance to malicious same-origin releases, every relay rollback/freshness attack, JavaScript memory forensics, real authenticator failures, or every authorization scenario. A synthetic local-CA HTTPS check does not verify public-domain certificate issuance. A local gzip round trip does not establish off-host encryption, production RPO/RTO, or a full operator disaster drill.

## Reproduce

Use the README checks with a synthetic database and installed Chrome. Run the supplied CI workflow for the additional engine matrix. Build `still-api:release`, `still-web:release` and `still-database:release` using the corresponding infrastructure Dockerfiles, then run `pnpm test:containers`. It creates a randomly named loopback-only fixture stack, verifies migrations, gzip recovery and suites, and removes only that stack and its fixture volume.

The workspace checks used `node scripts/container-smoke.mjs --prepare` followed by explicit Compose/recovery/test commands because the approval service timed out on the combined command. Both observed test projects, `still-smoke-34deec00` and `still-smoke-cb5d4713`, were isolated from the development database. Their generated environment files and fixture volumes are removed after verification. The proxy used an independently disposable local certificate fixture; no host/browser trust was installed.

Generated artifacts live under ignored `artifacts/` and browser reports under ignored `playwright-report/` and `test-results/`. Do not use or export a real user's browser profile for these checks.
