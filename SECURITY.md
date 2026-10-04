# Security policy

This repository is a release candidate for security-sensitive software. An independent audit, real authenticator/browser review, final-domain deployment verification, and recovery drill remain release gates. No FIPS certification or universal-browser security guarantee is claimed.

Do not report secrets in public issues. Use the repository host's **private vulnerability reporting** feature when its maintainers enable it. If no private channel is available, open only a minimal public request for a private contact, without exploit detail or sensitive artifacts. A production operator must publish and test an actual private security contact before launch; this project does not invent a contact address or response-time promise.

Include the affected version, impact, a synthetic reproduction, and suggested mitigation. Exclude real setup keys, recovery kits, account/vault exports, authentication codes, API keys, session cookies, or browser storage dumps. Reports about the separate server-readable verifier should identify that trust boundary explicitly.

Review [threat model](docs/security/threat-model.md), [privacy inventory](docs/security/privacy.md), and [release gates](docs/operations/release.md). Dependency or scanner findings require a documented remediation or time-bounded disposition; absence of known findings is not an audit.
