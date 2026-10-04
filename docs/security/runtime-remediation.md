# Runtime image remediation and source provenance

Package and image scans are separate release checks. The application lock audit does not cover tools and system libraries bundled into a base image. All four shipped service images must pass the recorded high-severity gate; medium findings still need review. No vulnerability-ignore file suppresses findings.

The Node API/web images remove unused npm, yarn, apk tooling and system zlib. The proxy uses the pinned official Caddy binary, preserves the system TLS trust store, removes unused curl/package-manager dependencies, and runs as UID 10001 with a read-only root filesystem and no capabilities. Its certificate and configuration volumes remain writable. The Compose low-port setting applies only to that container's network namespace. Existing certificate volumes must have the correct ownership before adopting this runtime.

PostgreSQL needs compression support for supported backup and restore tools. Removing zlib or choosing an unreviewed older image would not satisfy that requirement. The database Dockerfile builds the upstream snapshot containing the [non-blocking gzip buffer fix](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148), runs upstream tests, and installs it as a real replacement package. The snapshot identifies itself as **1.3.2.1-motley**, packaged locally as `zlib 1.3.2.1-r0`; this is not an official Alpine patch release. The [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-85091) links that upstream fix and documents the affected-range discussion.

| Source property | Value                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL base | `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`                        |
| zlib commit     | `df84af25dc1942490e1d1c899a07619152a46148`                                                                          |
| Archive         | [Immutable commit archive](https://codeload.github.com/madler/zlib/tar.gz/df84af25dc1942490e1d1c899a07619152a46148) |
| Archive SHA-256 | `03a76732cfaa124c58b67600699d935d081604385c03aa282f81a101b7536161`                                                  |
| Runtime license | Upstream README retained at `/usr/share/licenses/zlib/README`                                                       |
| Metadata        | Package version, SONAME provider and upstream source/hash image labels retained                                     |

The builder uses the official `dl-4.alpinelinux.org` mirror with ordinary Alpine package signature verification; the default CDN was unreachable in this workspace. The unsigned local package is accepted only from the checksum-pinned build stage. Compiler tools remain outside the runtime image. Source compilation and a clean scan do not substitute for independent review of the snapshot. Review new upstream/distribution releases and replace this temporary packaging with a supported official fixed release after testing.

`scripts/database-recovery-smoke.mjs` accepts only the prepared synthetic project pattern and reserved test ports. It checks a gzip logical backup, atomic restore, fixture integrity and all four schema versions. It deliberately modifies the synthetic schema and must never be adapted to run directly against a live database. A local synthetic round trip is separate from a measured production/off-host disaster-recovery drill.

Use the [verification report](../operations/verification-report.md) for observed image IDs, scanner database date, findings and test results. Preserve the raw image scan reports and source materials with the release; build and sign immutable final images through the reviewed operator pipeline.
