# Developer MFA verifier API

The verifier is optional and disabled in production unless explicitly configured. It uses a separate schema and AWS KMS envelope context. **The verifier service can decrypt its own enrollment seeds.** Consumer vault ciphertext and keys must never be submitted to these endpoints.

All paths are under `/api`. Requests and responses are JSON. Use HTTPS. A trusted application server sends `Authorization: Bearer still_<opaque-key>`; do not expose API keys in client JavaScript, mobile bundles, URLs, or logs. The consumer Origin/session guards are separate from server-to-server bearer authorization. API keys have `enroll` and/or `verify` scopes, a maximum 90-day expiry, and immediate revocation.

## Consumer-session administration

| Method / path                                    | Behavior                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| GET `/developer/status`                          | Whether the verifier is enabled; explicit `server-readable-verifier` trust label                   |
| GET / POST `/developer/applications`             | List owned application metadata / create application; create requires fresh passkey authentication |
| GET `/developer/applications/:id/keys`           | Owned key metadata, scopes, expiry, revocation, usage; never returns a stored key                  |
| POST `/developer/applications/:id/keys`          | `{scopes:["verify"],days:30}`; returns `{id,key}` once                                             |
| DELETE `/developer/keys/:id`                     | Revoke an owned key; fresh authentication                                                          |
| GET `/developer/applications/:id/credentials`    | Owned bounded credential metadata, no seed/subject material                                        |
| POST `/developer/credentials/:id/recovery-codes` | Generate ten random 128-bit one-time codes; invalidates prior codes; fresh authentication          |
| DELETE `/developer/credentials/:id`              | Disable and delete the owned factor and its recovery hashes; fresh authentication                  |

Administrative writes require the exact application Origin and a JSON content type, including DELETE requests with an empty body. A fresh passkey assertion establishes a five-minute reauthentication window. Ownership is checked on each operation. Limits are 100 applications per account, 100 unexpired/unrevoked keys per application, and 10,000 pending/active credentials per application.

## Enrollment, confirmation, and verification

POST `/mfa/enrollments` requires `enroll` scope:

```json
{
  "subject": "8b93c0fb-e60d-4c63-b575-bdc4120e575b",
  "issuer": "Example application",
  "account": "alice@example.test",
  "type": "totp",
  "algorithm": "SHA-256",
  "digits": 8,
  "period": 30
}
```

`subject` must be a stable, opaque application-owned UUID. Authenticate your user and bind this UUID to their account in your own server. The verifier hashes application + subject, stores encrypted seed material, and returns `{credentialId,uri}` once. Display the provisioning URI as a local QR or setup key to that user. Do not log the URI or cache the response. Store the returned credential ID in your application's subject mapping.

The defaults are TOTP, HMAC-SHA-256, eight digits, and a 30-second step. SHA-1/SHA-512, six digits, HOTP, and bounded 5–300-second periods are explicit compatibility options. SHA-512 receives a random 512-bit seed; other new enrollments receive 256 bits.

POST `/mfa/:credentialId/confirm` requires `enroll` scope and `{code:"12345678"}`. A correct OTP proves possession and activates the pending factor. Pending enrollments expire after 24 hours. Confirmation consumes that step/counter; immediately replaying it at verification fails.

POST `/mfa/:credentialId/verify` requires `verify` scope with the same body. Only active credentials can verify. A successful response is `{verified:true}`. Invalid, already consumed, inactive, wrong-tenant, or missing credentials produce generic failure; your application must fail closed and apply its own account/session throttles.

TOTP accepts the current step or immediately preceding step and rejects steps at or below the last accepted step. Future steps are not accepted. HOTP searches the current counter through current + 5 and advances beyond the accepted counter. Database row locks make concurrent verification/recovery consumption atomic. The verifier permits five guesses per credential/application in five minutes and 120 authorized API requests per application per minute, in addition to the pre-parser request limit.

A generated 22-character recovery code can be submitted to `/verify` once. It is a separate verifier recovery mechanism, not a consumer vault recovery key. Constant-time equality protects same-length OTP comparison; response latency is not guaranteed globally indistinguishable.

## Factor and API-key replacement

To replace an active factor, enroll the same `subject` with `replacesCredentialId` set to its current active ID. The API binds that reference to the same application and subject. The old credential continues to verify while the new one awaits confirmation. Correct new-factor confirmation atomically activates the replacement and deletes the old credential/recovery hashes. Failed or expired confirmation leaves the old factor active. Only one active factor per application/subject is allowed by a database unique index. A replacement whose old factor was already disabled cannot activate. Update your application's credential mapping only after successful confirmation.

API-key rotation uses create → securely deploy the new key → verify integration → revoke the previous key. Recovery-code regeneration immediately replaces all previous codes. Disabling a factor is destructive; ensure another authenticated recovery/sign-in method exists first.

## Errors and deployment

Successful POSTs return HTTP 201. Authorization/proof failures return 401 or 403, invalid bodies 400, conflicting enrollment/state 409, exhausted storage/body limits 413, unsupported administrative content type 415, throttling 429, and internal errors a generic 500. Never interpret a non-success response as verified. Retry 429 with bounded backoff; do not repeat successful verification as an idempotent operation, because replay protection intentionally rejects it.

Production requires `MFA_ENABLED=true`, `AWS_REGION`, `KMS_KEY_ID`, and a least-privilege workload IAM identity with only the required Encrypt/Decrypt permissions on that verifier key. Context includes purpose, application UUID, and credential UUID; ciphertext transplant across credentials fails. Do not copy a development encryption key into production. Validate real IAM denial cases and KMS outages in staging before enabling the service. Audit operations with metadata only, never request bodies, bearer values, URIs, OTPs, or recovery codes.

This service does not provide end-user sessions, password recovery, anti-phishing guarantees for OTP, email delivery, a push MFA service, or identity proofing. The integrating application remains responsible for authenticated enrollment, correct subject binding, additional recovery methods, and secure delivery of setup material.
