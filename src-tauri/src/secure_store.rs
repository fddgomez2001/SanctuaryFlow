//! Small secrets (cloud sign-in session) encrypted with Windows DPAPI, so
//! they can only be read by the same Windows user on the same computer.
//! Values are never logged.

use std::path::{Path, PathBuf};

use sanctuary_core::{Error, Result};

/// Keys the frontend may store. Anything else is rejected.
const ALLOWED_KEYS: &[&str] = &["supabase-session"];

fn path_for(dir: &Path, key: &str) -> Result<PathBuf> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err(Error::validation("Unknown secure storage key."));
    }
    Ok(dir.join(format!("{key}.bin")))
}

#[cfg(windows)]
mod dpapi {
    use sanctuary_core::{Error, Result};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };

    const ENTROPY: &[u8] = b"SanctuaryFlow secure store v1";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: on success the API returns a LocalAlloc'd buffer of cbData bytes.
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(out.pbData as _) };
        v
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        let input = blob(plain);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: all pointers reference live buffers for the duration of the call.
        let ok = unsafe {
            CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 {
            return Err(Error::Other("Windows could not encrypt the secret.".into()));
        }
        Ok(unsafe { take(out) })
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>> {
        let input = blob(cipher);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: as above.
        let ok = unsafe {
            CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 {
            return Err(Error::Other("The stored secret could not be decrypted (it may belong to another Windows user).".into()));
        }
        Ok(unsafe { take(out) })
    }
}

#[cfg(not(windows))]
mod dpapi {
    use sanctuary_core::{Error, Result};
    pub fn protect(_: &[u8]) -> Result<Vec<u8>> {
        Err(Error::Unsupported("Secure storage is only available on Windows.".into()))
    }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>> {
        Err(Error::Unsupported("Secure storage is only available on Windows.".into()))
    }
}

pub fn set(dir: &Path, key: &str, value: &str) -> Result<()> {
    let path = path_for(dir, key)?;
    std::fs::create_dir_all(dir)?;
    let cipher = dpapi::protect(value.as_bytes())?;
    let tmp = path.with_extension("partial");
    std::fs::write(&tmp, cipher)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn get(dir: &Path, key: &str) -> Result<Option<String>> {
    let path = path_for(dir, key)?;
    match std::fs::read(&path) {
        Ok(cipher) => match dpapi::unprotect(&cipher) {
            Ok(plain) => Ok(Some(String::from_utf8(plain).map_err(|_| Error::Other("The stored secret is damaged.".into()))?)),
            Err(e) => {
                log::warn!("discarding unreadable secret '{key}'");
                let _ = std::fs::remove_file(&path);
                Err(e)
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(dir: &Path, key: &str) -> Result<()> {
    let path = path_for(dir, key)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_key_whitelist() {
        let dir = tempfile_dir();
        set(&dir, "supabase-session", "{\"access_token\":\"abc\"}").unwrap();
        let raw = std::fs::read(dir.join("supabase-session.bin")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("access_token"), "stored encrypted");
        assert_eq!(get(&dir, "supabase-session").unwrap().as_deref(), Some("{\"access_token\":\"abc\"}"));
        delete(&dir, "supabase-session").unwrap();
        assert_eq!(get(&dir, "supabase-session").unwrap(), None);
        assert!(set(&dir, "../evil", "x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn tempfile_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("sf-secure-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
