//! SanctuaryFlow core engine: local SQLite storage, Bible catalog and import,
//! songs, service plans, media, backup/restore and the synchronization outbox.
//!
//! This crate has no Tauri dependency so it can be tested quickly in isolation.

// Nested `if let` blocks are kept where they read more clearly than let chains.
#![allow(clippy::collapsible_if)]

pub mod backup;
pub mod bible;
pub mod canon;
pub mod dashboard;
pub mod db;
pub mod deck_import;
pub mod error;
pub mod media;
pub mod migrations;
pub mod seed;
pub mod service_io;
pub mod services;
pub mod settings;
pub mod slides;
pub mod song_io;
pub mod songs;
pub mod sync;
pub mod themes;
pub mod util;

pub use db::Database;
pub use error::{Error, Result};
