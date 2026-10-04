# Using Still

## Protect the local vault

Create a long, unique passphrase of at least 15 characters. Still does not send it to the API. Save the displayed recovery kit offline, separately from your encrypted backup. A recovery key plus the encrypted vault data can decrypt the vault; a recovery key alone cannot reconstruct deleted account records.

The default lock policy locks after five minutes of inactivity and when the page is hidden. Lock immediately with the sidebar button or Ctrl/Command–Shift–L. Unlocking another tab locks the previous tab; cooperating tabs serialize vault mutations. Browser extensions and compromised operating systems are outside this protection boundary.

## Add and use accounts

Enter the issuer-provided setup key, paste an `otpauth://` URI, scan a camera QR, or upload a QR image. Review issuer, account, algorithm, digits, period, and type before saving. Scanning is local; camera tracks stop when scanning closes. Do not change the algorithm of an existing enrollment: the remote service must use the same parameters.

TOTP codes follow the operating system clock. Enable automatic clock synchronization if codes fail. Near expiration, copying may wait for the next step; the threshold is configurable. Locking cancels a pending copy. HOTP advances only when explicitly used and persists the new counter before releasing the old counter's code. If clipboard access fails after persistence, that counter remains consumed; coordinate resynchronization with the issuer instead of moving it backwards.

Privacy mode hides names and codes. It is a shoulder-surfing aid, not an encryption boundary. The browser cannot guarantee clipboard deletion or prevent operating system clipboard synchronization. Prefer direct entry where clipboard exposure matters.

Search matches issuer, account, tags, and aliases, with exact/prefix/substring/fuzzy ranking. Favorites, archive, usage-based sorting, custom metadata, folders, and manual order are available. The dashboard shows up to 100 matches at a time; narrow the search for larger vaults. Usage can be disabled in Settings.

## Import and back up

File imports support bounded CSV, OTP JSON arrays, Still plaintext import JSON, plaintext Aegis v1, and one otpauth URI per line. A preview reports valid rows, duplicates, and unsupported rows. No accounts are saved until confirmation. Choose skip, keep both, or replace for duplicates; a single IndexedDB transaction saves the reviewed batch. Unsupported encrypted exports and Google migration/2FAS-specific formats are rejected rather than guessed. Plaintext source files contain seeds; remove them after checking an encrypted backup.

Download a `.otpvault` encrypted backup after confirming the local passphrase. Whole-vault backups update the freshness indicator; selective backups do not. A selective restore replaces that vault's local contents with the selected records. Other vaults on the same browser are preserved. Keep a complete backup too.

Restoration authenticates the entire manifest and every record before replacing local data. A wrong passphrase, wrong recovery key, or modified file leaves the existing encrypted records intact. Older backups retain their old passphrase after a passphrase change. A key rotation creates a new recovery kit and requires a fresh backup.

Unreadable records are retained and reported. Use the encrypted recovery archive to preserve raw data for expert investigation; this archive is not a verified backup and cannot repair missing ciphertext automatically. Do not overwrite the only copy of a damaged vault.

If you forgot the passphrase, unlock with the recovery key, then use Settings → Change passphrase → Verify with Recovery key to establish a new passphrase. Make a new backup immediately.

## Cloud accounts, pairing, and shared vaults

Cloud accounts are optional. Register a passkey, then add a second independent passkey before relying on cloud access. Cloud authentication does not unlock the local vault. Losing every passkey does not grant a server reset path; an offline encrypted backup remains recoverable with its local credential.

Sync uploads only encrypted records and authenticated operation proofs. It finishes by locking the local vault. Conflicts remain visible until you choose local, remote, or keep both; the server cannot read account labels to decide for you. Retry an interrupted sync after unlocking; persisted operation IDs make retries idempotent.

On a new authorized device, create local protection and sign in. Choose Receive a vault, generate the public pairing request, and transfer it directly to a trusted device. On the trusted device, select that vault, approve the request with its local passphrase and a fresh passkey assertion. Compare every group of the verification fingerprint on both screens. Receive only after they match. Save the new device's recovery kit, then sync the encrypted records.

Shared vaults have independent keys and local credentials. Owners can grant admin/member/viewer roles; admins cannot grant or remove owners or peer admins. Members can write; viewers can download and generate codes. Anyone who receives a shared key can obtain the shared seeds. Removing a member rotates the key for future data, but cannot erase data already copied. Re-pair remaining devices and download new backups after rotation.

## Developer and operator workflows

Developer Tools computes local test vectors, generates setup keys, inspects URIs, and displays provisioning QRs. Use public fixtures for debugging. Do not paste real secrets into tickets or remote debug consoles.

The optional MFA platform lets signed-in developers create applications, create/revoke scoped API keys, inspect credential metadata, regenerate one-time recovery codes, and disable credentials. Integrate enrollment/confirmation/verification only from a trusted server; the [API guide](api/mfa-verifier.md) explains subject binding, factor replacement, replay limits, and AWS KMS.

Operators deploy and monitor the API without consumer vault decryption keys. Treat the verifier's KMS access as a different, higher-trust responsibility. See the deployment and incident runbooks before production use.
