//! Built-in data seeded on every start. Seeding never overwrites user changes:
//! built-in themes are inserted once and settings only receive missing keys.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use crate::canon;
use crate::error::Result;
use crate::util::{new_id, now_iso};

pub const THEME_CLASSIC_BLACK: &str = "00000000-0000-4000-8000-000000000001";
pub const THEME_MIDNIGHT_BLUE: &str = "00000000-0000-4000-8000-000000000002";
pub const THEME_SCRIPTURE: &str = "00000000-0000-4000-8000-000000000003";
pub const THEME_ANNOUNCEMENT: &str = "00000000-0000-4000-8000-000000000004";
pub const THEME_HIGH_CONTRAST: &str = "00000000-0000-4000-8000-000000000005";
pub const THEME_GOLDEN_HOUR: &str = "00000000-0000-4000-8000-000000000006";
pub const THEME_ROYAL_GOLD: &str = "00000000-0000-4000-8000-000000000007";
pub const THEME_GOLD_SCRIPTURE: &str = "00000000-0000-4000-8000-000000000008";
pub const THEME_METALLIC_GOLD: &str = "00000000-0000-4000-8000-000000000009";

pub fn seed_all(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    canon::seed(&tx)?;
    seed_themes(&tx)?;
    seed_settings(&tx)?;
    seed_device(&tx)?;
    tx.commit()?;
    Ok(())
}

fn base_theme() -> serde_json::Value {
    json!({
        "fontFamily": "Inter Variable",
        "fontSize": 72,
        "fontWeight": 600,
        "textColor": "#FFFFFF",
        "textAlign": "center",
        "verticalAlign": "middle",
        "lineHeight": 1.25,
        "textTransform": "none",
        "textShadow": true,
        "textOutline": false,
        "safeMargin": 6,
        "background": {
            "type": "black",
            "color": "#000000",
            "mediaId": null,
            "fit": "cover",
            "overlayColor": "#000000",
            "overlayOpacity": 0,
            "videoLoop": true,
            "videoMuted": true
        },
        "reference": { "show": true, "position": "bottom", "fontSize": 40, "color": "#D6DEEA", "showTranslation": true },
        "verseNumbers": { "show": true },
        "footer": { "showSongInfo": false, "fontSize": 24, "color": "#A8B2C1" },
        "logo": { "show": false, "mediaId": null, "position": "bottom-right", "size": 10 },
        "transition": { "type": "fade", "durationMs": 300 }
    })
}

fn merge(mut base: serde_json::Value, patch: serde_json::Value) -> serde_json::Value {
    if let (Some(b), Some(p)) = (base.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            match (b.get_mut(k), v) {
                (Some(existing @ serde_json::Value::Object(_)), serde_json::Value::Object(_)) => {
                    *existing = merge(existing.clone(), v.clone());
                }
                _ => {
                    b.insert(k.clone(), v.clone());
                }
            }
        }
    }
    base
}

pub fn builtin_themes() -> Vec<(&'static str, &'static str, &'static str, serde_json::Value)> {
    vec![
        (THEME_CLASSIC_BLACK, "Classic Black", "song", base_theme()),
        (
            THEME_MIDNIGHT_BLUE,
            "Midnight Blue",
            "song",
            merge(base_theme(), json!({ "background": { "type": "color", "color": "#0B1F3A" } })),
        ),
        (
            THEME_SCRIPTURE,
            "Scripture Classic",
            "scripture",
            merge(
                base_theme(),
                json!({
                    "fontFamily": "Georgia",
                    "fontSize": 60,
                    "fontWeight": 500,
                    "lineHeight": 1.35,
                    "textAlign": "left",
                    "background": { "type": "color", "color": "#101318" },
                    "reference": { "show": true, "position": "bottom", "fontSize": 40 }
                }),
            ),
        ),
        (
            THEME_ANNOUNCEMENT,
            "Announcement",
            "announcement",
            merge(
                base_theme(),
                json!({
                    "fontSize": 64,
                    "fontWeight": 700,
                    "background": { "type": "color", "color": "#0F4C81" },
                    "transition": { "type": "fade", "durationMs": 400 }
                }),
            ),
        ),
        (
            THEME_HIGH_CONTRAST,
            "High Contrast Yellow",
            "general",
            merge(base_theme(), json!({ "textColor": "#FFE14D", "fontWeight": 700, "textShadow": false })),
        ),
        // Elegant gold looks for song lyrics, announcements and Scripture.
        (
            THEME_GOLDEN_HOUR,
            "Golden Hour",
            "song",
            merge(
                base_theme(),
                json!({
                    "fontFamily": "Montserrat Variable",
                    "fontSize": 70,
                    "fontWeight": 600,
                    "lineHeight": 1.32,
                    "background": { "type": "black", "style": "gold-glow" },
                    "transition": { "type": "fade", "durationMs": 500 }
                }),
            ),
        ),
        (
            THEME_ROYAL_GOLD,
            "Royal Gold",
            "announcement",
            merge(
                base_theme(),
                json!({
                    "fontFamily": "Outfit Variable",
                    "fontSize": 64,
                    "fontWeight": 600,
                    "lineHeight": 1.3,
                    "textColor": "#F8F4EA",
                    "safeMargin": 10,
                    "background": { "type": "color", "color": "#0E152B", "style": "royal-night" },
                    "transition": { "type": "rise", "durationMs": 500 }
                }),
            ),
        ),
        (
            THEME_GOLD_SCRIPTURE,
            "Gold Scripture",
            "scripture",
            merge(
                base_theme(),
                json!({
                    "fontFamily": "Georgia",
                    "fontSize": 58,
                    "fontWeight": 400,
                    "lineHeight": 1.42,
                    "textColor": "#F5EEDC",
                    "safeMargin": 10,
                    "background": { "type": "black", "style": "warm-dusk" },
                    "reference": { "show": true, "position": "top", "fontSize": 46, "color": "#E0B95C", "showTranslation": true },
                    "transition": { "type": "fade", "durationMs": 500 }
                }),
            ),
        ),
        // The default look for song lyrics: white Arial with a shadow on metallic gold.
        (
            THEME_METALLIC_GOLD,
            "Metallic Gold",
            "song",
            merge(
                base_theme(),
                json!({
                    "fontFamily": "Arial",
                    "fontSize": 72,
                    "fontWeight": 700,
                    "lineHeight": 1.28,
                    "textColor": "#FFFFFF",
                    "textShadow": true,
                    "background": { "type": "color", "color": "#A67C28", "style": "metallic-gold" },
                    "reference": { "color": "#FFF4D6" },
                    "footer": { "color": "#FFF4D6" },
                    "transition": { "type": "fade", "durationMs": 400 }
                }),
            ),
        ),
    ]
}

fn seed_themes(conn: &Connection) -> Result<()> {
    let now = now_iso();
    for (id, name, category, settings) in builtin_themes() {
        conn.execute(
            // Built-ins are identical on every device, so they start in sync and
            // only upload if the operator edits them.
            "INSERT OR IGNORE INTO presentation_themes (id, name, category, is_builtin, settings, created_at, updated_at,
               synced_revision)
             VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5, 1)",
            params![id, name, category, settings.to_string(), now],
        )?;
    }
    Ok(())
}

pub fn default_settings() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("general.churchName", json!("")),
        // The operator's name, asked on first start and used to greet them.
        ("general.userName", json!("")),
        ("general.onboardingDone", json!(false)),
        ("general.defaultLanguage", json!("en")),
        ("general.reopenLastService", json!(true)),
        ("general.uiTheme", json!("light")),
        ("presentation.defaultSongThemeId", json!(THEME_METALLIC_GOLD)),
        ("presentation.defaultScriptureThemeId", json!(THEME_SCRIPTURE)),
        ("presentation.bibleNowThemeId", json!(THEME_GOLD_SCRIPTURE)),
        ("presentation.defaultAnnouncementThemeId", json!(THEME_ANNOUNCEMENT)),
        ("presentation.outputDisplay", json!(null)),
        ("presentation.maxLinesPerSlide", json!(4)),
        ("presentation.maxScriptureCharsPerSlide", json!(320)),
        ("presentation.scriptureSplit", json!("fit")),
        ("presentation.advanceAcrossItems", json!(false)),
        ("presentation.logoMediaId", json!(null)),
        ("presentation.ccliLicenseNumber", json!("")),
        ("bible.defaultTranslationId", json!(null)),
        ("bible.hideParagraphMarks", json!(true)),
        ("library.warnMissingCopyright", json!(true)),
        ("backup.directory", json!(null)),
        ("backup.includeMedia", json!(true)),
        ("backup.scheduleEnabled", json!(false)),
        ("backup.scheduleIntervalHours", json!(168)),
        ("backup.keepCount", json!(10)),
        ("sync.enabled", json!(false)),
        ("sync.supabaseUrl", json!("")),
        ("sync.supabaseAnonKey", json!("")),
        ("sync.workspaceId", json!("")),
        ("sync.workspaceName", json!("")),
        (
            "keyboard.shortcuts",
            json!({
                "next": ["ArrowRight", "Space", "PageDown"],
                "previous": ["ArrowLeft", "PageUp"],
                "blank": ["KeyB"],
                "clear": ["KeyC"],
                "logo": ["KeyL"],
                "exit": ["Escape"],
                "first": ["Home"],
                "last": ["End"],
                "nextItem": ["ArrowDown"],
                "previousItem": ["ArrowUp"]
            }),
        ),
    ]
}

fn seed_settings(conn: &Connection) -> Result<()> {
    let now = now_iso();
    for (key, value) in default_settings() {
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value.to_string(), now],
        )?;
    }
    Ok(())
}

fn seed_device(conn: &Connection) -> Result<()> {
    let existing: Option<String> = conn
        .query_row("SELECT value FROM device_metadata WHERE key = 'device_id'", [], |r| r.get(0))
        .optional()?;
    if existing.is_none() {
        conn.execute("INSERT INTO device_metadata (key, value) VALUES ('device_id', ?1)", [new_id()])?;
        conn.execute("INSERT INTO device_metadata (key, value) VALUES ('created_at', ?1)", [now_iso()])?;
    }
    Ok(())
}

pub fn device_id(conn: &Connection) -> Result<String> {
    Ok(conn.query_row("SELECT value FROM device_metadata WHERE key = 'device_id'", [], |r| r.get(0))?)
}
