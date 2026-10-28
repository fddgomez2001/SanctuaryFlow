use std::io::Read;
use std::path::Path;

use chrono::{SecondsFormat, Utc};
use sha2::{Digest, Sha256};

use crate::error::Result;

/// Current time as an ISO-8601 UTC string with millisecond precision.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Time-ordered UUID (v7) as a lowercase hyphenated string.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn is_valid_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

/// Trims a string and converts empty strings to `None`.
pub fn clean_opt(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let t = v.trim();
        if t.is_empty() { None } else { Some(t.to_string()) }
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Streams a reader through SHA-256 without loading it into memory.
pub fn sha256_reader(mut reader: impl Read) -> Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

pub fn sha256_file(path: &Path) -> Result<(String, u64)> {
    sha256_reader(std::io::BufReader::new(std::fs::File::open(path)?))
}

/// Normalizes text for duplicate detection: lowercase, alphanumerics only,
/// single spaces. Unicode letters are preserved so non-English titles compare.
pub fn normalize_for_compare(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = true;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim_end().to_string()
}

/// Builds an FTS5 MATCH expression from free text: every token becomes a quoted
/// prefix term, so user input can never inject FTS syntax.
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|t| t.trim_matches('\''))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    if terms.is_empty() { None } else { Some(terms.join(" ")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_quotes_tokens() {
        assert_eq!(fts_query("amazing grace"), Some("\"amazing\"* \"grace\"*".into()));
        assert_eq!(fts_query("  \"OR\" NEAR(  "), Some("\"OR\"* \"NEAR\"*".into()));
        assert_eq!(fts_query("--- "), None);
        assert_eq!(fts_query("Panginoon, ikaw"), Some("\"Panginoon\"* \"ikaw\"*".into()));
    }

    #[test]
    fn normalize_compares_loosely() {
        assert_eq!(normalize_for_compare("  Amazing   Grace! "), "amazing grace");
        assert_eq!(normalize_for_compare("Ikaw Lamang"), normalize_for_compare("ikaw-lamang"));
        assert_eq!(normalize_for_compare("Ñino"), "ñino");
    }
}
