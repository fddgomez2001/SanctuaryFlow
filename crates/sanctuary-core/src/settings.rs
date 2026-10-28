use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{Error, Result};
use crate::util::now_iso;

pub type SettingsMap = BTreeMap<String, serde_json::Value>;

pub fn get_all(conn: &Connection) -> Result<SettingsMap> {
    let mut stmt = conn.prepare("SELECT key, value FROM app_settings ORDER BY key")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = SettingsMap::new();
    for row in rows {
        let (key, raw) = row?;
        let value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
        map.insert(key, value);
    }
    Ok(map)
}

pub fn get(conn: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
    let raw: Option<String> =
        conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    Ok(raw.map(|r| serde_json::from_str(&r).unwrap_or(serde_json::Value::Null)))
}

pub fn get_string(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(get(conn, key)?.and_then(|v| v.as_str().map(str::to_string)).filter(|s| !s.is_empty()))
}

fn validate_key(key: &str) -> Result<()> {
    let ok = !key.is_empty()
        && key.len() <= 128
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    if ok { Ok(()) } else { Err(Error::validation(format!("Invalid setting key '{key}'"))) }
}

pub fn set(conn: &Connection, key: &str, value: &serde_json::Value) -> Result<()> {
    validate_key(key)?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value.to_string(), now_iso()],
    )?;
    Ok(())
}

pub fn set_many(conn: &mut Connection, values: &SettingsMap) -> Result<()> {
    let tx = conn.transaction()?;
    for (k, v) in values {
        set(&tx, k, v)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;

    #[test]
    fn defaults_are_seeded_and_updates_persist() {
        let db = Database::open_in_memory().unwrap();
        let all = db.read(get_all).unwrap();
        assert_eq!(all.get("presentation.maxLinesPerSlide"), Some(&json!(4)));
        db.write(|c| set(c, "general.churchName", &json!("Grace Fellowship"))).unwrap();
        assert_eq!(
            db.read(|c| get_string(c, "general.churchName")).unwrap().as_deref(),
            Some("Grace Fellowship")
        );
        assert!(db.write(|c| set(c, "bad key!", &json!(1))).is_err());
    }
}
