# Browser capabilities and limits

| Capability                 | Requirement / fallback                                               | Release evidence                                                                                        |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Vault/OTP                  | Web Crypto, worker, IndexedDB, WASM; HTTPS or trusted localhost      | Installed Chrome automated tests; other engines configured in CI                                        |
| Argon2id                   | WASM and 64 MiB worker allocation                                    | No silent weaker fallback; allocation failure blocks creation/unlock                                    |
| Cloud passkeys             | Resident credentials with user verification, correct HTTPS RP domain | Chromium virtual authenticator; real platform and roaming authenticators remain manual gates            |
| Passkey PRF local unlock   | Not implemented                                                      | Passphrase/recovery remain the explicit local credentials; passkey login does not imply vault unlocking |
| Camera QR                  | Camera permission, secure context, supported media APIs              | Image upload/manual entry fallback; real camera/device testing required                                 |
| Clipboard                  | Browser permission and foreground activation                         | Clear failure feedback; cannot guarantee wiping OS clipboard/history or synced copies                   |
| Offline installation       | Service worker and cache completed before disconnect                 | Offline reload tested in Chrome; first-ever visit still requires app assets                             |
| Persistent storage         | `navigator.storage.persist` grant is browser policy                  | Request UI; denied grant does not prevent use; external backups required                                |
| Private browsing           | Storage/permission support varies                                    | Failure must remain visible; no persistent-storage guarantee                                            |
| Multi-tab concurrency      | Web Locks and BroadcastChannel on modern supported browsers          | Cooperative-tab locking tested; cannot constrain hostile same-origin code                               |
| Background execution       | Not guaranteed                                                       | Lock-on-hide by default; no claims of reliable background code generation, push, or notifications       |
| Memory clearing            | Worker termination and best-effort byte clearing                     | Cannot prove zeroization of JS strings, copied DOM content, GC heaps, swap or browser snapshots         |
| Hardware-bound key custody | Not available for an ordinary unlocked browser vault                 | A non-extractable CryptoKey can still be used by compromised application code                           |

The production CSP uses exact hashes for generated bootstrap scripts, same-origin modules, and `wasm-unsafe-eval` for Argon2 WASM. It excludes `unsafe-inline`, general `unsafe-eval`, third-party scripts, and framing. CSP reduces injection paths; it cannot defeat a malicious same-origin release, compromised dependency, extension, browser, or operating system.

Treat Firefox, WebKit/iOS Safari, Android, real security keys, assistive technology, high zoom, and constrained-memory devices as **unverified until their recorded release checks pass**. Do not advertise blanket browser support based on Chrome alone.
