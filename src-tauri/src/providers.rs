//! Authorized Bible providers. Each provider declares what its license
//! terms allow (bulk download, offline storage, redistribution); only
//! translations whose terms permit offline storage can be downloaded.
//!
//! eBible.org publishes a machine-readable catalog of translations with a
//! `Redistributable` flag and offers downloadable USFM packages for them, so
//! no scraping is involved.

use std::path::{Path, PathBuf};

use sanctuary_core::bible::TranslationMetadataInput;
use sanctuary_core::{Error, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub homepage: String,
    pub requires_api_key: bool,
    pub allows_bulk_download: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTranslation {
    pub provider_id: String,
    pub id: String,
    pub suggested_code: String,
    pub title: String,
    pub short_title: String,
    pub language_code: String,
    pub language_name: String,
    pub copyright: String,
    pub public_domain: bool,
    pub redistributable: bool,
    pub ot_books: u32,
    pub nt_books: u32,
    pub dc_books: u32,
    pub updated: String,
    pub text_direction: String,
    pub details_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalog {
    pub translations: Vec<ProviderTranslation>,
    /// The catalog came from the local cache because the network was unavailable.
    pub from_cache: bool,
    pub fetched_at: Option<String>,
}

/// The trait every provider adapter implements.
#[allow(async_fn_in_trait)]
pub trait BibleProvider {
    fn info(&self) -> ProviderInfo;
    async fn catalog(&self, client: &reqwest::Client, cache_dir: &Path, refresh: bool) -> Result<ProviderCatalog>;
    /// Downloads a translation package and returns the local file path.
    async fn download(&self, client: &reqwest::Client, cache_dir: &Path, translation: &ProviderTranslation) -> Result<PathBuf>;
    /// Metadata to pre-fill the import form, including license terms.
    fn metadata(&self, translation: &ProviderTranslation) -> TranslationMetadataInput;
}

pub struct EBible;

const EBIBLE_CATALOG: &str = "https://ebible.org/Scriptures/translations.csv";
const MAX_DOWNLOAD: usize = 150 * 1024 * 1024;

fn well_known_code(id: &str) -> Option<&'static str> {
    Some(match id {
        "engwebp" => "WEB",
        "engwebpb" => "WEBBE",
        "eng-web" => "WEBC",
        "eng-kjv2006" => "KJV",
        "eng-kjv" => "KJVA",
        "eng-asv" => "ASV",
        "engylt" => "YLT",
        "engbsb" => "BSB",
        "engdra" => "DRA",
        "enggnv" => "GNV",
        "tglulb" => "TGLULB",
        _ => return None,
    })
}

fn parse_catalog(text: &str) -> Result<Vec<ProviderTranslation>> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let headers: Vec<String> = reader.headers().map_err(|e| Error::Other(format!("eBible catalog: {e}")))?.iter().map(str::to_string).collect();
    let col = |n: &str| headers.iter().position(|h| h == n);
    let need = |n: &str| col(n).ok_or_else(|| Error::Other(format!("The eBible catalog format changed (missing '{n}').")));
    let (c_lang, c_id, c_langname, c_title, c_redis, c_copy, c_upd, c_ot, c_nt, c_dc, c_dir, c_down, c_short) = (
        need("languageCode")?,
        need("translationId")?,
        need("languageNameInEnglish")?,
        need("title")?,
        need("Redistributable")?,
        need("Copyright")?,
        need("UpdateDate")?,
        need("OTbooks")?,
        need("NTbooks")?,
        need("DCbooks")?,
        need("textDirection")?,
        need("downloadable")?,
        need("shortTitle")?,
    );
    let mut out = Vec::new();
    for rec in reader.records() {
        let Ok(rec) = rec else { continue };
        let g = |i: usize| rec.get(i).unwrap_or("").trim().to_string();
        let redistributable = g(c_redis).eq_ignore_ascii_case("true");
        let downloadable = g(c_down).eq_ignore_ascii_case("true");
        // Only texts whose copyright holders permit redistribution (and thus
        // offline copies) are offered.
        if !redistributable || !downloadable {
            continue;
        }
        let id = g(c_id);
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        let copyright = g(c_copy);
        let suggested = well_known_code(&id)
            .map(str::to_string)
            .unwrap_or_else(|| id.to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect());
        out.push(ProviderTranslation {
            provider_id: "ebible".into(),
            suggested_code: suggested,
            title: g(c_title),
            short_title: g(c_short),
            language_code: g(c_lang),
            language_name: g(c_langname),
            public_domain: copyright.to_lowercase().contains("public domain"),
            copyright,
            redistributable,
            ot_books: g(c_ot).parse().unwrap_or(0),
            nt_books: g(c_nt).parse().unwrap_or(0),
            dc_books: g(c_dc).parse().unwrap_or(0),
            updated: g(c_upd),
            text_direction: if g(c_dir) == "rtl" { "rtl".into() } else { "ltr".into() },
            details_url: format!("https://ebible.org/find/details.php?id={id}"),
            id,
        });
    }
    out.sort_by(|a, b| a.language_name.cmp(&b.language_name).then(a.title.cmp(&b.title)));
    Ok(out)
}

impl BibleProvider for EBible {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: "ebible".into(),
            name: "eBible.org".into(),
            description: "Public-domain and openly licensed Bible translations that their copyright holders allow to be \
                          redistributed, downloaded as USFM packages."
                .into(),
            homepage: "https://ebible.org".into(),
            requires_api_key: false,
            allows_bulk_download: true,
        }
    }

    async fn catalog(&self, client: &reqwest::Client, cache_dir: &Path, refresh: bool) -> Result<ProviderCatalog> {
        let cache = cache_dir.join("translations.csv");
        let cached_meta = std::fs::metadata(&cache).ok();
        let fresh_enough = cached_meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|age| age.as_secs() < 7 * 24 * 3600)
            .unwrap_or(false);
        if !refresh && fresh_enough {
            let text = std::fs::read_to_string(&cache)?;
            return Ok(ProviderCatalog { translations: parse_catalog(&text)?, from_cache: true, fetched_at: None });
        }
        let fetched = async {
            let resp = client.get(EBIBLE_CATALOG).send().await?.error_for_status()?;
            resp.text().await
        }
        .await;
        match fetched {
            Ok(text) => {
                let translations = parse_catalog(&text)?;
                std::fs::create_dir_all(cache_dir)?;
                std::fs::write(&cache, &text)?;
                Ok(ProviderCatalog { translations, from_cache: false, fetched_at: Some(sanctuary_core::util::now_iso()) })
            }
            Err(e) if cache.exists() => {
                log::warn!("eBible catalog fetch failed, using cache: {e}");
                let text = std::fs::read_to_string(&cache)?;
                Ok(ProviderCatalog { translations: parse_catalog(&text)?, from_cache: true, fetched_at: None })
            }
            Err(e) => Err(Error::Other(format!(
                "Could not reach eBible.org ({}). Check the internet connection, or import a downloaded file instead.",
                e.without_url()
            ))),
        }
    }

    async fn download(&self, client: &reqwest::Client, cache_dir: &Path, t: &ProviderTranslation) -> Result<PathBuf> {
        let url = format!("https://ebible.org/Scriptures/{}_usfm.zip", t.id);
        let resp = client
            .get(&url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| Error::Other(format!("The download failed ({}).", e.without_url())))?;
        if resp.content_length().map(|l| l as usize > MAX_DOWNLOAD).unwrap_or(false) {
            return Err(Error::validation("The translation package is unexpectedly large."));
        }
        let bytes = resp.bytes().await.map_err(|e| Error::Other(format!("The download was interrupted ({}).", e.without_url())))?;
        if bytes.len() > MAX_DOWNLOAD || !bytes.starts_with(b"PK") {
            return Err(Error::validation("The downloaded file is not a valid translation package."));
        }
        std::fs::create_dir_all(cache_dir)?;
        let path = cache_dir.join(format!("{}_usfm.zip", t.id));
        let tmp = path.with_extension("partial");
        std::fs::write(&tmp, &bytes)?;
        std::fs::rename(&tmp, &path)?;
        Ok(path)
    }

    fn metadata(&self, t: &ProviderTranslation) -> TranslationMetadataInput {
        TranslationMetadataInput {
            code: t.suggested_code.clone(),
            name: if t.title.is_empty() { t.short_title.clone() } else { t.title.clone() },
            language: t.language_code.clone(),
            versification: None,
            text_direction: Some(t.text_direction.clone()),
            publisher: None,
            source_provider: Some("eBible.org".into()),
            source_url: Some(t.details_url.clone()),
            license_name: Some(if t.public_domain { "Public Domain".into() } else { "See copyright notice".into() }),
            license_url: Some(format!("https://ebible.org/{}/copyright.htm", t.id)),
            copyright_notice: Some(t.copyright.clone()),
            attribution_text: Some(format!("{}. {} Text from eBible.org.", t.title, t.copyright)),
            // The copyright holder marked this text redistributable, which
            // includes keeping a local copy.
            offline_permitted: Some(true),
            redistribution_permitted: Some(true),
            modification_permitted: if t.public_domain { Some(true) } else { None },
            downloaded_at: Some(sanctuary_core::util::now_iso()),
            notes: None,
        }
    }
}

/// Plain-text license statement from the `copr.htm` file inside a package.
pub fn package_license_text(zip_path: &Path) -> Option<String> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip_path).ok()?).ok()?;
    let mut f = archive.by_name("copr.htm").ok()?;
    let mut html = String::new();
    f.read_to_string(&mut html).ok()?;
    let mut text = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            c if !in_tag => text.push(c),
            _ => {}
        }
    }
    let text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&copy;", "©");
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(collapsed.chars().take(3000).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_keeps_only_redistributable_downloads() {
        let csv = "\u{feff}\"languageCode\",\"translationId\",\"languageName\",\"languageNameInEnglish\",\"dialect\",\"homeDomain\",\"title\",\"description\",\"Redistributable\",\"Copyright\",\"UpdateDate\",\"publicationURL\",\"OTbooks\",\"OTchapters\",\"OTverses\",\"NTbooks\",\"NTchapters\",\"NTverses\",\"DCbooks\",\"DCchapters\",\"DCverses\",\"FCBHID\",\"Certified\",\"inScript\",\"swordName\",\"rodCode\",\"textDirection\",\"downloadable\",\"font\",\"shortTitle\",\"PODISBN\",\"script\",\"sourceDate\"\n\
\"eng\",\"engwebp\",\"English\",\"English\",\"\",\"x\",\"World English Bible\",\"d\",\"True\",\"public domain\",\"2026-01-01\",\"\",\"39\",\"929\",\"0\",\"27\",\"260\",\"0\",\"0\",\"0\",\"0\",\"\",\"True\",\"\",\"\",\"\",\"ltr\",\"True\",\"\",\"WEB\",\"\",\"Latin\",\"\"\n\
\"eng\",\"engnope\",\"English\",\"English\",\"\",\"x\",\"Restricted\",\"d\",\"False\",\"© Publisher\",\"2026-01-01\",\"\",\"39\",\"929\",\"0\",\"27\",\"260\",\"0\",\"0\",\"0\",\"0\",\"\",\"True\",\"\",\"\",\"\",\"ltr\",\"True\",\"\",\"R\",\"\",\"Latin\",\"\"\n";
        let list = parse_catalog(csv).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].suggested_code, "WEB");
        assert!(list[0].public_domain);
        let m = EBible.metadata(&list[0]);
        assert_eq!(m.offline_permitted, Some(true));
        assert_eq!(m.license_name.as_deref(), Some("Public Domain"));
    }
}
