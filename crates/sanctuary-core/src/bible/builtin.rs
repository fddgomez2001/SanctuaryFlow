//! Bibles that ship with the app, installed on the first start after they
//! were added. Each is installed once: a translation the operator deletes
//! stays deleted.

use std::io::Cursor;

use rusqlite::Connection;
use serde_json::json;

use super::import::{self, ImportOptions, ImportSource};
use super::{TranslationMetadataInput, find_translation_by_code};
use crate::error::Result;
use crate::settings;
use crate::util::now_iso;

/// The built-in codes that were installed once (a setting).
const INSTALLED_KEY: &str = "bible.builtinInstalled";

pub struct BuiltinBible {
    pub code: &'static str,
    pub name: &'static str,
    /// eBible.org's id for the translation.
    ebible_id: &'static str,
    /// eBible.org's USFM package, unchanged.
    package: &'static [u8],
}

pub const BUILTIN_BIBLES: &[BuiltinBible] = &[BuiltinBible {
    code: "ASV",
    name: "American Standard Version (1901)",
    ebible_id: "eng-asv",
    package: include_bytes!("../../../../shared/bible/eng-asv_usfm.zip"),
}];

impl BuiltinBible {
    /// The same details as a download of this translation from eBible.org.
    fn metadata(&self, versification: Option<String>) -> TranslationMetadataInput {
        TranslationMetadataInput {
            code: self.code.into(),
            name: self.name.into(),
            language: "eng".into(),
            versification,
            text_direction: Some("ltr".into()),
            source_provider: Some("eBible.org".into()),
            source_url: Some(format!("https://ebible.org/find/details.php?id={}", self.ebible_id)),
            license_name: Some("Public Domain".into()),
            license_url: Some(format!("https://ebible.org/{}/copyright.htm", self.ebible_id)),
            copyright_notice: Some("Public Domain".into()),
            attribution_text: Some(format!("{}. Public Domain. Text from eBible.org.", self.name)),
            offline_permitted: Some(true),
            redistribution_permitted: Some(true),
            modification_permitted: Some(true),
            downloaded_at: Some(now_iso()),
            notes: Some("Built into SanctuaryFlow.".into()),
            ..Default::default()
        }
    }
}

/// Installs the built-in Bibles this library has never had and returns their
/// codes. One already imported under the same code is kept as it is. The
/// first one becomes the default translation when there is none.
pub fn install_builtin_bibles(conn: &mut Connection) -> Result<Vec<String>> {
    let mut installed: Vec<String> = settings::get(conn, INSTALLED_KEY)?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let mut added = Vec::new();
    for bible in BUILTIN_BIBLES {
        if installed.iter().any(|c| c == bible.code) {
            continue;
        }
        if find_translation_by_code(conn, bible.code)?.is_none() {
            let sources = import::read_zip(Cursor::new(bible.package))?;
            let format = import::detect_format(&sources)?;
            let checksum = import::checksum_sources(&sources);
            let parsed = import::parse_sources(format, &sources)?;
            let source = ImportSource {
                kind: "provider".into(),
                format,
                path: None,
                provider: Some("eBible.org".into()),
                checksum: Some(checksum),
            };
            let options = ImportOptions {
                metadata: bible.metadata(parsed.metadata.versification.clone()),
                replace_existing: false,
                acknowledge_exclusions: true,
            };
            let result = import::commit(conn, &parsed, &source, options, &|_, _| {})?;
            if settings::get_string(conn, "bible.defaultTranslationId")?.is_none() {
                settings::set(conn, "bible.defaultTranslationId", &json!(result.translation_id))?;
            }
            added.push(bible.code.to_string());
        }
        installed.push(bible.code.to_string());
        settings::set(conn, INSTALLED_KEY, &json!(installed))?;
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bible::{delete_translation, get_chapter, list_translations};
    use crate::db::Database;

    #[test]
    fn asv_is_installed_once_and_becomes_the_default() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.write(install_builtin_bibles).unwrap(), ["ASV"]);
        let asv = db.read(|c| find_translation_by_code(c, "ASV")).unwrap().unwrap();
        assert_eq!(asv.name, "American Standard Version (1901)");
        assert_eq!(asv.license_name.as_deref(), Some("Public Domain"));
        assert_eq!((asv.validation_status.as_str(), asv.book_count), ("complete", 66));
        assert!(asv.verse_count > 31_000, "{} verses", asv.verse_count);
        let john3 = db.read(|c| get_chapter(c, &asv.id, "JHN", 3)).unwrap();
        assert!(john3[15].text.starts_with("For God so loved the world"), "{}", john3[15].text);
        assert_eq!(db.read(|c| settings::get_string(c, "bible.defaultTranslationId")).unwrap(), Some(asv.id.clone()));

        // Installed once: a deleted built-in stays deleted.
        assert!(db.write(install_builtin_bibles).unwrap().is_empty());
        db.write(|c| delete_translation(c, &asv.id)).unwrap();
        assert!(db.write(install_builtin_bibles).unwrap().is_empty());
        assert!(db.read(list_translations).unwrap().is_empty());
    }
}
