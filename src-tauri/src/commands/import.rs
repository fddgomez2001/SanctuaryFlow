//! Importing finished presentations (PowerPoint, ZIPs of pictures, single
//! pictures) as picture slides. PDF pages are drawn by the operator window
//! with pdf.js and stored through `media_import_bytes`.

use std::io::Read;
use std::path::{Path, PathBuf};

use sanctuary_core::{Error, Result, deck_import, media};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use super::media::safe_file_name;
use crate::office;
use crate::state::{AppState, blocking};

const POWERPOINT_EXTENSIONS: &[&str] = &["pptx", "ppt", "pptm", "ppsx", "pps", "potx", "odp"];
const MAX_PDF_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedSlide {
    pub media_id: String,
    pub notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedPresentation {
    pub slides: Vec<ConvertedSlide>,
    pub method: &'static str,
    pub warnings: Vec<String>,
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

#[tauri::command]
pub fn powerpoint_available() -> bool {
    office::powerpoint_available()
}

/// Converts a presentation into pictures stored in the media library, in
/// slide order. The slide deck itself is built by the operator window.
#[tauri::command]
pub async fn presentation_convert(state: State<'_, AppState>, path: String) -> Result<ConvertedPresentation> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        let source = PathBuf::from(&path);
        let ext = extension(&source);
        let stem = safe_file_name(source.file_stem().and_then(|s| s.to_str()).unwrap_or("Slides"));
        let work = tempfile::Builder::new().prefix("sanctuaryflow-import-").tempdir()?;
        let mut warnings = Vec::new();
        let (files, method): (Vec<(PathBuf, Option<String>)>, &'static str) = if POWERPOINT_EXTENSIONS.contains(&ext.as_str()) {
            let exported = office::export_with_powerpoint(&source, &work.path().join("export"))?;
            if exported.hidden > 0 {
                let one = exported.hidden == 1;
                warnings.push(format!(
                    "{} hidden slide{} {} left out, as in the slide show.",
                    exported.hidden,
                    if one { "" } else { "s" },
                    if one { "was" } else { "were" }
                ));
            }
            (exported.slides.into_iter().map(|s| (s.path, Some(s.notes).filter(|n| !n.trim().is_empty()))).collect(), "powerpoint")
        } else if ext == "zip" {
            (deck_import::extract_zip_images(&source, &work.path().join("pages"))?.into_iter().map(|p| (p, None)).collect(), "zip")
        } else if deck_import::is_image_name(&path) {
            (vec![(source.clone(), None)], "images")
        } else if ext == "pdf" {
            return Err(Error::validation("PDF files are imported through the Import presentation window."));
        } else {
            return Err(Error::Unsupported(format!(
                "'.{ext}' files can't be imported as slides. Use PowerPoint (.pptx), PDF, a ZIP of pictures or a picture."
            )));
        };

        let mut slides = Vec::with_capacity(files.len());
        for (n, (file, notes)) in files.into_iter().enumerate() {
            // Readable names in the media library: "Sunday - slide 3".
            let named = if method == "images" {
                file
            } else {
                let label = if method == "powerpoint" { "slide" } else { "page" };
                let target = work.path().join(format!("{stem} - {label} {}.{}", n + 1, extension(&file)));
                std::fs::rename(&file, &target)?;
                target
            };
            // Slide pictures belong to the deck, not the Media Library list.
            let imported = db.write(|c| media::import_file_as(c, &root, &named, media::MediaPurpose::Slide))?;
            slides.push(ConvertedSlide { media_id: imported.asset.id, notes });
        }
        if slides.is_empty() {
            return Err(Error::validation("The presentation has no visible slides."));
        }
        Ok(ConvertedPresentation { slides, method, warnings })
    })
    .await
}

/// Reads a PDF chosen for import so the operator window can draw its pages.
#[tauri::command]
pub async fn import_read_file(path: String) -> Result<Response> {
    blocking(move || {
        let source = PathBuf::from(&path);
        if extension(&source) != "pdf" {
            return Err(Error::validation("Only PDF files are read this way."));
        }
        let meta = std::fs::metadata(&source).map_err(|_| Error::not_found(format!("{} could not be opened.", source.display())))?;
        if meta.len() > MAX_PDF_BYTES {
            return Err(Error::validation("The PDF is too large to import (over 512 MB)."));
        }
        let mut head = [0u8; 5];
        let read = std::fs::File::open(&source)?.read(&mut head)?;
        if read < 5 || &head != b"%PDF-" {
            return Err(Error::validation("The file does not look like a PDF. It may be damaged or misnamed."));
        }
        Ok(Response::new(std::fs::read(&source)?))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaInfo {
    pub title: String,
    pub view_url: String,
    /// The design's size in pixels, when Canva gives it.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Deserialize)]
struct OEmbed {
    #[serde(default)]
    title: String,
    width: Option<u32>,
    height: Option<u32>,
}

/// The public view address of a Canva design link, or None if it is not one.
fn canva_view_url(link: &str) -> Option<String> {
    let rest = link
        .trim()
        .strip_prefix("https://www.canva.com/design/")
        .or_else(|| link.trim().strip_prefix("https://canva.com/design/"))?;
    let mut parts = rest.split(['/', '?', '#']);
    let id = parts.next()?;
    let token = parts.next()?;
    let ok = |s: &str| (4..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    (ok(id) && ok(token) && !["view", "edit", "watch"].contains(&token)).then(|| format!("https://www.canva.com/design/{id}/{token}/view"))
}

/// The title and size of a public Canva design, from Canva's oEmbed service
/// (the standard way sites ask Canva about a design they embed).
#[tauri::command]
pub async fn canva_info(state: State<'_, AppState>, link: String) -> Result<CanvaInfo> {
    let view_url = canva_view_url(&link).ok_or_else(|| Error::validation("This is not a public Canva design link."))?;
    let endpoint = reqwest::Url::parse_with_params("https://www.canva.com/_oembed", &[("url", view_url.as_str()), ("format", "json")])
        .map_err(|e| Error::Other(e.to_string()))?;
    let response = state
        .http
        .get(endpoint)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| Error::Other(format!("Canva could not be reached: {e}")))?;
    if !response.status().is_success() {
        return Err(Error::validation("Canva did not find this design. Check that it is shared with “Anyone with the link”."));
    }
    let body = response.bytes().await.map_err(|e| Error::Other(format!("Canva's answer could not be read: {e}")))?;
    let info: OEmbed = serde_json::from_slice(&body).map_err(|e| Error::Other(format!("Canva's answer could not be read: {e}")))?;
    let size = |n: Option<u32>| n.filter(|n| (1..=100_000).contains(n));
    Ok(CanvaInfo { title: info.title.trim().to_string(), view_url, width: size(info.width), height: size(info.height) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub name: String,
    pub modified_ms: i64,
}

/// Presentation files that appeared in the Downloads folder since `since_ms`
/// (milliseconds since 1970), newest first. Used while the operator downloads
/// a design from Canva, so it can be brought in without searching for it.
/// Only names and times of new PDF, PowerPoint and ZIP files are looked at.
#[tauri::command]
pub async fn downloads_new_files(app: AppHandle, since_ms: i64) -> Result<Vec<DownloadedFile>> {
    let dir = match downloads_override() {
        Some(dir) => dir,
        None => app.path().download_dir().map_err(|_| Error::not_found("The Downloads folder could not be found."))?,
    };
    blocking(move || {
        let mut found = Vec::new();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(found);
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = extension(&path);
            if !["pdf", "pptx", "zip"].contains(&ext.as_str()) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() || meta.len() == 0 {
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            // A little slack for clocks and file systems that round times.
            if modified_ms + 2000 < since_ms {
                continue;
            }
            found.push(DownloadedFile { name: entry.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), modified_ms });
        }
        found.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
        found.truncate(10);
        Ok(found)
    })
    .await
}

/// End-to-end tests use their own folder instead of the real Downloads.
/// Debug builds only.
fn downloads_override() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("SANCTUARYFLOW_DOWNLOADS_DIR")
        && !dir.is_empty()
    {
        return Some(PathBuf::from(dir));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::canva_view_url;

    #[test]
    fn canva_links_become_view_addresses() {
        let view = Some("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view".to_string());
        assert_eq!(canva_view_url("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?embed"), view);
        assert_eq!(canva_view_url("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/edit?utm_source=x"), view);
        assert_eq!(canva_view_url("https://www.canva.com/design/DAGatIO09_0/view"), None);
        assert_eq!(canva_view_url("https://evil.example/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view"), None);
    }
}
