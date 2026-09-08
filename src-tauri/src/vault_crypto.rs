//! Real at-rest encryption for locked notes and folders.
//!
//! `locks.rs` is the *access gate* — it decides whether the app shows a
//! note's content in the UI. This module is what actually makes a locked
//! note's bytes on disk unreadable without the key: when a note is locked
//! (`locks::set_pin`), its file content is encrypted in place with
//! AES-256-GCM before it's written back to disk, and transparently
//! decrypted wherever the app legitimately reads note content (opening a
//! note, backlinks, the graph). Unlocking a note (`locks::remove_lock`)
//! decrypts it back to plain text on disk, restoring the original
//! "just a markdown file" portability for anything you don't lock.
//!
//! The PIN and the encryption key are deliberately two different things:
//! the PIN is a short, memorable, in-app gate (unchanged from before —
//! still a salted SHA-256 verifier in `locks.json`); the actual key is a
//! random 256-bit value generated once per vault and held in the OS
//! keychain (macOS Keychain, Windows Credential Manager, or the Linux
//! Secret Service via the `keyring` crate) — never written to disk in any
//! form. This split matters for recovery: forgetting a 4-digit PIN resets
//! the *gate*, not the key, so a "forgot my PIN" flow can never turn into
//! permanently unrecoverable data, and the encryption strength doesn't
//! depend on how guessable a 4-digit PIN is.
//!
//! Only vaults that actually lock something ever touch this module —
//! every other note stays exactly what it's always been: a plain `.md`
//! file, fully portable, readable by any editor, unaffected by any of
//! this.

use std::path::Path;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use keyring::Entry;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

const KEYCHAIN_SERVICE: &str = "Xuro Vault Key";
/// Prefixed onto every encrypted file's stored (base64) content so
/// `is_encrypted` can tell ciphertext from an ordinary note apart cheaply,
/// without attempting a decrypt. Versioned in case the format ever needs
/// to change; a lock created by a future version that bumps this would
/// simply fail to decrypt on an older build rather than silently
/// misreading it as plaintext.
const MAGIC: &[u8] = b"XUROENC1";
const NONCE_LEN: usize = 12; // AES-GCM's standard nonce size.

/// A stable-but-not-reversible identifier for a vault, used as the
/// keychain account name — so opening two different vaults on the same
/// machine gets two independent keys, and neither key can be derived from
/// the vault's path if the keychain entry alone leaked.
fn vault_account(root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    format!("vault-{}", hex_prefix(&hasher.finalize(), 16))
}

fn hex_prefix(bytes: &[u8], len: usize) -> String {
    bytes
        .iter()
        .take(len)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn keychain_entry(root: &Path) -> AppResult<Entry> {
    Entry::new(KEYCHAIN_SERVICE, &vault_account(root))
        .map_err(|error| AppError::Other(format!("keychain unavailable: {error}")))
}

/// The vault's master key: 32 random bytes, generated once and stored in
/// the OS keychain. Every call after the first just reads it back — nothing
/// about this key is ever derived from the PIN, and it never touches the
/// vault's own files (so it isn't swept up by syncing/copying the vault).
/// `pub(crate)` (not private) so `locks.rs` can fetch it once and encrypt
/// every file under a locked folder with it, instead of round-tripping to
/// the keychain once per file.
pub(crate) fn vault_key(root: &Path) -> AppResult<[u8; 32]> {
    // `cargo test` must never touch the real OS keychain: no CI box should
    // hang waiting on a secret-service daemon that isn't running, and no
    // dev machine should get a surprise macOS keychain permission prompt
    // from running the test suite. Test builds get a deterministic,
    // in-memory-only key derived from the vault path instead — real
    // encrypt/decrypt logic, just never touching the OS. Every place that
    // exercises actual keychain I/O (`keychain_entry`, the branches below)
    // only compiles into non-test builds.
    #[cfg(test)]
    {
        let mut hasher = Sha256::new();
        hasher.update(b"xuro-test-only-key-never-used-outside-cargo-test");
        hasher.update(root.to_string_lossy().as_bytes());
        let digest = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&digest);
        return Ok(key);
    }
    #[cfg(not(test))]
    {
        let entry = keychain_entry(root)?;
        match entry.get_password() {
            Ok(encoded) => decode_key(&encoded),
            Err(keyring::Error::NoEntry) => {
                let key: [u8; 32] = random_bytes(32)
                    .try_into()
                    .expect("random_bytes(32) is 32 bytes");
                entry
                    .set_password(&STANDARD.encode(key))
                    .map_err(|error| AppError::Other(format!("keychain write failed: {error}")))?;
                Ok(key)
            }
            Err(error) => Err(AppError::Other(format!("keychain read failed: {error}"))),
        }
    }
}

/// `len` fresh random bytes, sourced from `OsRng` via `AeadCore::generate_nonce`
/// (already used for the encryption nonce below) rather than a separate
/// `rand`/`rand_core` import — one less crate-internal API surface to get
/// wrong in code that can't be compiled and checked in this environment.
/// Each call draws directly from the OS's CSPRNG, so concatenating several
/// is exactly as random as one longer draw would be.
fn random_bytes(len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + NONCE_LEN);
    while out.len() < len {
        out.extend_from_slice(Aes256Gcm::generate_nonce(&mut OsRng).as_slice());
    }
    out.truncate(len);
    out
}

fn decode_key(encoded: &str) -> AppResult<[u8; 32]> {
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|_| AppError::Other("stored vault key is corrupted".to_string()))?;
    bytes
        .try_into()
        .map_err(|_| AppError::Other("stored vault key has the wrong length".to_string()))
}

/// `true` if `content` is this module's own ciphertext format — cheap
/// enough to call on every note read without a real decrypt attempt.
pub fn is_encrypted(content: &str) -> bool {
    STANDARD
        .decode(content.trim())
        .is_ok_and(|bytes| bytes.starts_with(MAGIC))
}

/// Encrypts `plaintext` for storage. The result is itself valid UTF-8
/// (base64), so it can still be written with `fs::write` like any other
/// note — it just isn't markdown anymore, which is the deliberate,
/// disclosed trade-off of locking something.
pub fn encrypt(root: &Path, plaintext: &str) -> AppResult<String> {
    encrypt_with_key(&vault_key(root)?, plaintext)
}

/// Reverses `encrypt`. Callers should check `is_encrypted` first — this
/// returns an error (rather than silently returning garbage) if handed
/// content that isn't actually in this format.
pub fn decrypt(root: &Path, stored: &str) -> AppResult<String> {
    decrypt_with_key(&vault_key(root)?, stored)
}

/// The actual AES-256-GCM work, split out from `encrypt` so tests can
/// exercise it with a fixed in-memory key instead of the real OS
/// keychain — `cargo test` should never prompt for keychain access or
/// depend on a secret-service daemon being available. `pub(crate)` so
/// `locks.rs` can reuse a single fetched key across a whole folder's
/// worth of files instead of hitting the keychain once per file.
pub(crate) fn encrypt_with_key(key: &[u8; 32], plaintext: &str) -> AppResult<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| AppError::Other("encryption failed".to_string()))?;

    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(out))
}

pub(crate) fn decrypt_with_key(key: &[u8; 32], stored: &str) -> AppResult<String> {
    let bytes = STANDARD
        .decode(stored.trim())
        .map_err(|_| AppError::Other("locked note content is corrupted".to_string()))?;
    let body = bytes
        .strip_prefix(MAGIC)
        .ok_or_else(|| AppError::Other("not encrypted content".to_string()))?;
    if body.len() < NONCE_LEN {
        return Err(AppError::Other("locked note content is corrupted".to_string()));
    }
    let (nonce_bytes, ciphertext) = body.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| {
            AppError::Other(
                "couldn't decrypt this note — the vault's key may be missing or changed"
                    .to_string(),
            )
        })?;
    String::from_utf8(plaintext)
        .map_err(|_| AppError::Other("decrypted note content is not valid text".to_string()))
}

/// Transparently returns plain text either way: decrypts if `content` is
/// this module's ciphertext, passes it through unchanged otherwise. This
/// is what every *read* path (opening a note, search, backlinks, graph)
/// should call instead of assuming a file's raw bytes are already
/// readable — the one exception is `locks.rs`'s own set/remove flows,
/// which call `encrypt`/`decrypt` directly since they're the ones
/// transitioning a note between the two states.
pub fn read_transparent(root: &Path, content: String) -> AppResult<String> {
    if is_encrypted(&content) {
        decrypt(root, &content)
    } else {
        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests exercise the AES-256-GCM logic directly against a fixed
    // in-memory key — never the real OS keychain. `cargo test` shouldn't
    // depend on a secret-service daemon running or risk a macOS keychain
    // permission prompt; `vault_key`/`keychain_entry` (the only functions
    // that actually touch the OS keychain) are covered by manual/desktop
    // testing instead, same as `cloud.rs`'s session file isn't unit-tested
    // against a real filesystem quota or permission edge case.
    const TEST_KEY: [u8; 32] = [7u8; 32];
    const OTHER_KEY: [u8; 32] = [9u8; 32];

    #[test]
    fn round_trips_through_encrypt_and_decrypt() {
        let ciphertext = encrypt_with_key(&TEST_KEY, "hello, this is secret").unwrap();
        assert!(is_encrypted(&ciphertext));
        assert_ne!(ciphertext, "hello, this is secret");
        assert_eq!(
            decrypt_with_key(&TEST_KEY, &ciphertext).unwrap(),
            "hello, this is secret"
        );
    }

    #[test]
    fn plaintext_is_never_flagged_as_encrypted() {
        assert!(!is_encrypted("# Just a normal note\n\nSome text."));
        assert!(!is_encrypted(""));
    }

    #[test]
    fn decrypting_with_the_wrong_key_fails_instead_of_returning_garbage() {
        let ciphertext = encrypt_with_key(&TEST_KEY, "only for the right key").unwrap();
        assert!(decrypt_with_key(&OTHER_KEY, &ciphertext).is_err());
    }

    #[test]
    fn decrypt_rejects_content_that_isnt_actually_encrypted() {
        let plain_b64 = STANDARD.encode("just some ordinary text");
        assert!(decrypt_with_key(&TEST_KEY, &plain_b64).is_err());
    }

    #[test]
    fn each_encryption_uses_a_fresh_nonce() {
        // Two encryptions of the same plaintext with the same key must
        // never produce identical ciphertext — reusing a nonce with
        // AES-GCM breaks its confidentiality guarantees entirely, so this
        // is the one invariant this module cannot afford to regress on.
        let a = encrypt_with_key(&TEST_KEY, "same content").unwrap();
        let b = encrypt_with_key(&TEST_KEY, "same content").unwrap();
        assert_ne!(a, b);
    }
}
