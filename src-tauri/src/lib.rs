mod canva_capture;
mod commands;
mod display;
mod office;
mod presentation;
mod providers;
mod secure_store;
mod state;

use std::path::PathBuf;

use sanctuary_core::Database;
use tauri::{Emitter, Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

use crate::display::DisplayManager;
use crate::presentation::{MAIN_LABEL, PROJECTOR_LABEL, PresentationHub};
use crate::state::{AppState, Paths};

fn data_dir_override() -> Option<PathBuf> {
    std::env::var("SANCTUARYFLOW_DATA_DIR").ok().filter(|d| !d.trim().is_empty()).map(PathBuf::from)
}

/// The library folder. `SANCTUARYFLOW_DATA_DIR` overrides it (used by the
/// end-to-end tests and for portable installs).
fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir_override().unwrap_or_else(|| app.path().app_data_dir().expect("the app data directory is available"))
}

/// With an overridden library folder the browser profile lives inside it, so
/// separate libraries never share (or fight over) one WebView2 process.
fn webview_data_dir() -> Option<PathBuf> {
    data_dir_override().map(|d| d.join("webview"))
}

/// WebView2 arguments. Every window must use the same arguments because they
/// share one browser process.
fn browser_args() -> String {
    #[allow(unused_mut)]
    let mut args = String::from(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
    );
    if let Some(port) = e2e_debug_port() {
        args.push_str(&format!(" --remote-debugging-port={port}"));
    }
    args
}

/// The end-to-end test debugging port. Debug builds only; release builds
/// never open one.
fn e2e_debug_port() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(port) = std::env::var("SANCTUARYFLOW_E2E_DEBUG_PORT")
        && !port.is_empty()
        && port.chars().all(|c| c.is_ascii_digit())
    {
        return Some(port);
    }
    None
}

fn open_library(paths: &Paths) -> (Option<Database>, Option<String>, Vec<String>) {
    match Database::open(&paths.db_path) {
        Ok((db, report)) => {
            let mut notices = Vec::new();
            if let Some(backup) = report.pre_migration_backup {
                notices.push(format!(
                    "Your library was upgraded to a new format. A copy of the previous version was saved to {}.",
                    backup.display()
                ));
            }
            (Some(db), None, notices)
        }
        Err(e) => {
            log::error!("could not open library: {e}");
            (None, Some(e.to_string()), Vec::new())
        }
    }
}

/// Two copies of the app must never open the same library. Debug builds with
/// an explicit data folder (end-to-end tests) may run side by side, because
/// each uses its own library.
fn single_instance_required() -> bool {
    !(cfg!(debug_assertions) && data_dir_override().is_some())
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    if single_instance_required() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN_LABEL) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::LogDir { file_name: Some("sanctuaryflow".into()) }),
                    Target::new(TargetKind::Stdout),
                ])
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(5_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = Paths::new(&data_dir(&handle));
            paths.create_all()?;
            log::info!("SanctuaryFlow {} starting; library at {}", env!("CARGO_PKG_VERSION"), paths.data_dir.display());

            let hub = PresentationHub::new(paths.presentation_file.clone());
            let (db, error, notices) = open_library(&paths);
            let state = AppState::new(paths.clone(), db, hub);
            *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = error;
            *state.startup_notices.lock().unwrap_or_else(|p| p.into_inner()) = notices;
            app.manage(state);

            let args = browser_args();
            app.manage(DisplayManager { target: Default::default(), browser_args: args.clone(), webview_data_dir: webview_data_dir() });

            // Media is served to the windows from the managed folder only.
            app.asset_protocol_scope().allow_directory(&paths.media_dir, true)?;

            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_LABEL)
                .cloned()
                .expect("main window is configured");
            let mut main = WebviewWindowBuilder::from_config(&handle, &config)?.additional_browser_args(&args);
            if let Some(dir) = webview_data_dir() {
                main = main.data_directory(dir);
            }
            if e2e_debug_port().is_some() {
                // Lets the tests answer file pickers they cannot drive, and
                // keeps the opening greeting and first-start welcome out of
                // tests that are not about them.
                let flag = |name: &str| std::env::var(name).is_ok_and(|v| v == "1");
                let greet = flag("SANCTUARYFLOW_E2E_GREETING");
                let welcome = flag("SANCTUARYFLOW_E2E_WELCOME");
                main = main.initialization_script(format!(
                    "window.__SANCTUARYFLOW_E2E__ = true; window.__SANCTUARYFLOW_E2E_GREETING__ = {greet}; window.__SANCTUARYFLOW_E2E_WELCOME__ = {welcome};"
                ));
            }
            let main = main.build()?;
            main.show()?;

            display::start_watcher(handle.clone());
            commands::backup::start_scheduler(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                match window.label() {
                    MAIN_LABEL => {
                        // Closing the operator console ends the session, including the output.
                        if let Some(p) = app.get_webview_window(PROJECTOR_LABEL) {
                            let _ = p.destroy();
                        }
                        app.exit(0);
                    }
                    PROJECTOR_LABEL => {
                        let manager = app.state::<DisplayManager>();
                        *manager.target.lock().unwrap_or_else(|p| p.into_inner()) = Default::default();
                        let status = display::status(app, &manager);
                        let _ = app.emit_to(MAIN_LABEL, display::EVENT_PROJECTOR_CHANGED, status);
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::dashboard_summary,
            commands::app::settings_get_all,
            commands::app::settings_set,
            commands::app::settings_set_many,
            commands::app::secure_get,
            commands::app::secure_set,
            commands::app::secure_delete,
            commands::library::songs_list,
            commands::library::songs_get,
            commands::library::songs_save,
            commands::library::songs_duplicate,
            commands::library::songs_delete,
            commands::library::songs_set_archived,
            commands::library::songs_set_favorite,
            commands::library::songs_record_use,
            commands::library::songs_facets,
            commands::library::songs_parse_lyrics,
            commands::library::songs_export,
            commands::library::songs_import_preview,
            commands::library::songs_import_commit,
            commands::library::services_list,
            commands::library::services_get,
            commands::library::services_save,
            commands::library::services_duplicate,
            commands::library::services_delete,
            commands::library::services_mark_opened,
            commands::library::services_export,
            commands::library::services_import,
            commands::library::themes_list,
            commands::library::themes_save,
            commands::library::themes_duplicate,
            commands::library::themes_delete,
            commands::library::decks_list,
            commands::library::decks_get,
            commands::library::decks_save,
            commands::library::decks_duplicate,
            commands::library::decks_delete,
            commands::bible::bible_translations,
            commands::bible::bible_translation_update,
            commands::bible::bible_translation_delete,
            commands::bible::bible_books,
            commands::bible::bible_chapter,
            commands::bible::bible_passage,
            commands::bible::bible_search,
            commands::bible::bible_passage_use,
            commands::bible::bible_passage_favorite,
            commands::bible::bible_saved_passages,
            commands::bible::bible_saved_passage_remove,
            commands::bible::bible_validation_report,
            commands::bible::bible_revalidate,
            commands::bible::bible_import_jobs,
            commands::bible::bible_import_preview,
            commands::bible::bible_import_discard,
            commands::bible::bible_import_commit,
            commands::bible::bible_providers,
            commands::bible::bible_provider_catalog,
            commands::bible::bible_provider_download,
            commands::media::media_list,
            commands::media::media_get,
            commands::media::media_import,
            commands::media::media_update,
            commands::media::media_set_probe,
            commands::media::media_set_thumbnail,
            commands::media::media_import_bytes,
            commands::media::media_import_folder,
            commands::media::media_folders,
            commands::media::media_set_folder,
            commands::media::media_rename_folder,
            commands::import::powerpoint_available,
            commands::import::presentation_convert,
            commands::import::import_read_file,
            commands::import::canva_info,
            canva_capture::canva_capture_open,
            canva_capture::canva_capture_page,
            canva_capture::canva_capture_close,
            commands::import::downloads_new_files,
            commands::media::media_references,
            commands::media::media_delete,
            commands::media::media_supported_extensions,
            commands::backup::backup_create,
            commands::backup::backup_validate,
            commands::backup::backup_history,
            commands::backup::backup_restore,
            commands::backup::library_export,
            commands::backup::library_import,
            commands::sync::sync_status,
            commands::sync::sync_pending,
            commands::sync::sync_mark_pushed,
            commands::sync::sync_mark_failed,
            commands::sync::sync_mark_conflict,
            commands::sync::sync_apply_remote,
            commands::sync::sync_conflicts,
            commands::sync::sync_resolve,
            commands::sync::sync_backfill,
            commands::sync::sync_reset,
            commands::sync::sync_get_meta,
            commands::sync::sync_set_meta,
            commands::presentation::displays_list,
            commands::presentation::projector_open,
            commands::presentation::projector_close,
            commands::presentation::projector_status,
            commands::presentation::presentation_update,
            commands::presentation::presentation_get_state,
            commands::presentation::presentation_save_session,
            commands::presentation::presentation_clear_session,
            commands::presentation::presentation_recovery,
            commands::presentation::projector_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SanctuaryFlow");
}
