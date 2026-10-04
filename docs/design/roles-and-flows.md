# Roles and interface decisions

The visual direction uses calm typography, generous space, restrained violet accents, and prominent monospaced codes. The main action is copying the desired code. Protection status and recovery actions remain visible without competing with that action. Icons use a local SVG system; no issuer logos, remote fonts, or tracking assets disclose account choices.

| Role                               | Primary tasks                                     | Interface and authorization                                                                                                           |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Local vault owner                  | Enroll, generate codes, organize, recover         | Offline onboarding, explicit recovery confirmation, searchable cards, worker-enforced credential checks                               |
| Cloud account holder               | Manage passkeys/devices, sync, pair               | Dedicated cloud area; passkey identity remains separate from local unlocking; sensitive cloud changes require fresh user verification |
| Shared owner                       | Create independent vault, invite, rotate          | Shared area, owner label, independent recovery kit; server ownership checks on every mutation                                         |
| Shared admin                       | Invite members/viewers, remove them and rotate    | Cannot change owners or peer admins; role options match server permissions                                                            |
| Shared member                      | Read/write shared accounts                        | Same usable OTP cards; independent selected-vault context                                                                             |
| Shared viewer                      | Read and generate shared codes                    | Writes are omitted during sync; server denies mutations; local copies cannot be made cryptographically read-only                      |
| MFA developer/application operator | Enroll users, verify, manage API keys and factors | Local toolkit plus separate verifier management; secret material displayed once; scopes enforced by the API                           |
| Infrastructure/security operator   | Deploy, recover, investigate                      | Runbooks, health checks, minimal metadata and generic errors; no consumer seed viewer or decryption dashboard                         |

## Interaction requirements

- Every account card exposes issuer/account, type, code, time remaining or counter, copy/advance action, favorite, and details. Secrets are absent from ordinary card state.
- Manual, scan, and import tabs share one review flow. Malformed input produces a bounded, generic explanation; no secret is echoed in an error.
- Native dialogs trap focus, support Escape, and use unique accessible titles. Inputs have labels, errors use alert semantics, and code copy feedback uses a status region.
- Destructive actions require an explicit credential or fresh passkey proof and clear consequences. Bulk imports require preview confirmation; backups show their scope.
- The mobile navigation makes the underlying content inert while open. Logical CSS properties support RTL. Reduced motion, forced colors, high zoom, and keyboard use are considered.
- Auto-lock removes account metadata and unmounts sensitive account/developer/cloud components. Sensitive exports require another credential check. Clipboard behavior and storage eviction limits are explained where they affect decisions.
- Locale and theme are the only plaintext local preferences. Core flows have twelve locales. Advanced security/developer messages currently remain English; full translation and native-language review are release work.

## Verification

Playwright covers onboarding, QR review, backup authentication, offline startup, mobile RTL overflow, privacy, tab locking, and virtual passkey login. Axe checks the tested onboarding, add-account, and dashboard states. Screenshots can be regenerated with `node scripts/visual-review.mjs` using only public RFC fixtures. Automated checks do not replace keyboard-only, screen-reader, high-zoom, hardware passkey, or native-language review.
