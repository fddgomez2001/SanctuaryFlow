//! Helpers for importing finished presentations as picture slides: a ZIP of
//! exported pages (Canva "PNG" downloads, slide exports) is unpacked into
//! numbered files in presentation order.

use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
/// Largest single picture accepted from an archive.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGES: usize = 1000;

pub fn is_image_name(name: &str) -> bool {
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    IMAGE_EXTENSIONS.contains(&ext.as_str())
}

/// Orders names the way people number pages: "2.png" before "10.png".
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.as_bytes(), b.as_bytes());
    loop {
        match (a.first(), b.first()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let da = a.iter().take_while(|c| c.is_ascii_digit()).count();
                let db = b.iter().take_while(|c| c.is_ascii_digit()).count();
                let na = std::str::from_utf8(&a[..da]).unwrap_or("0").trim_start_matches('0');
                let nb = std::str::from_utf8(&b[..db]).unwrap_or("0").trim_start_matches('0');
                let ord = na.len().cmp(&nb.len()).then_with(|| na.cmp(nb));
                if ord != Ordering::Equal {
                    return ord;
                }
                a = &a[da..];
                b = &b[db..];
            }
            (Some(x), Some(y)) => {
                let ord = x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a = &a[1..];
                b = &b[1..];
            }
        }
    }
}

/// Unpacks the pictures in `zip_path` into `out_dir`, ordered by file name.
/// Entry names are never used as paths (files are written as `page-0001.png`
/// and so on), so an archive cannot write outside `out_dir`.
pub fn extract_zip_images(zip_path: &Path, out_dir: &Path) -> Result<Vec<PathBuf>> {
    let file = std::fs::File::open(zip_path).map_err(|_| Error::not_found(format!("{} could not be opened.", zip_path.display())))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| Error::validation("The file is not a valid ZIP archive."))?;
    let mut entries: Vec<(usize, String)> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        let name = entry.name()?.to_string();
        let base = name.rsplit('/').next().unwrap_or(&name);
        // Skip folders, hidden files and macOS resource forks.
        if entry.is_dir() || base.starts_with('.') || name.starts_with("__MACOSX/") || !is_image_name(base) {
            continue;
        }
        entries.push((i, name));
    }
    if entries.is_empty() {
        return Err(Error::validation("The ZIP archive contains no pictures (.png, .jpg, .webp, .bmp or .gif)."));
    }
    if entries.len() > MAX_IMAGES {
        return Err(Error::validation(format!("The ZIP archive has more than {MAX_IMAGES} pictures.")));
    }
    entries.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    std::fs::create_dir_all(out_dir)?;
    let mut paths = Vec::with_capacity(entries.len());
    for (n, (index, name)) in entries.iter().enumerate() {
        let mut entry = archive.by_index(*index)?;
        if entry.size() > MAX_IMAGE_BYTES {
            return Err(Error::validation(format!("{name} is too large to use as a slide.")));
        }
        let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
        let dest = out_dir.join(format!("page-{:04}.{ext}", n + 1));
        let mut out = std::fs::File::create(&dest)?;
        // Read at most the limit even if the archive under-reports the size.
        let mut limited = (&mut entry).take(MAX_IMAGE_BYTES + 1);
        let copied = std::io::copy(&mut limited, &mut out)?;
        if copied > MAX_IMAGE_BYTES {
            drop(out);
            let _ = std::fs::remove_file(&dest);
            return Err(Error::validation(format!("{name} is too large to use as a slide.")));
        }
        out.flush()?;
        paths.push(dest);
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn orders_numbers_naturally() {
        let mut names = vec!["Page 10.png", "page 2.png", "Page 1.png", "cover.png", "Page 02b.png"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["cover.png", "Page 1.png", "page 2.png", "Page 02b.png", "Page 10.png"]);
    }

    #[test]
    fn unpacks_pictures_in_page_order_and_ignores_everything_else() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("design.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let opts = SimpleFileOptions::default();
            for name in ["design/10.png", "design/2.png", "design/1.png", "__MACOSX/design/._1.png", "design/notes.txt", "../../escape.png"] {
                w.start_file(name, opts).unwrap();
                w.write_all(if name.ends_with(".png") { PNG } else { b"text" }).unwrap();
            }
            w.add_directory("design/empty/", opts).unwrap();
            w.finish().unwrap();
        }
        let out = dir.path().join("out");
        let files = extract_zip_images(&zip_path, &out).unwrap();
        let names: Vec<_> = files.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["page-0001.png", "page-0002.png", "page-0003.png", "page-0004.png"]);
        assert!(files.iter().all(|p| p.starts_with(&out)));
        assert!(!dir.path().join("escape.png").exists());
        assert_eq!(std::fs::read(&files[0]).unwrap(), PNG);
    }

    #[test]
    fn rejects_archives_without_pictures() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("text.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            w.start_file("readme.txt", SimpleFileOptions::default()).unwrap();
            w.write_all(b"hello").unwrap();
            w.finish().unwrap();
        }
        let err = extract_zip_images(&zip_path, &dir.path().join("out")).unwrap_err();
        assert_eq!(err.code(), "validation");
        std::fs::write(dir.path().join("broken.zip"), b"not a zip").unwrap();
        assert_eq!(extract_zip_images(&dir.path().join("broken.zip"), &dir.path().join("o2")).unwrap_err().code(), "validation");
    }
}
