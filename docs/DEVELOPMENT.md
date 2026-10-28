# Development, architecture and testing

## Prerequisites (Windows 10/11)

| Tool | Notes |
| --- | --- |
| Node.js 22+ and pnpm 10 | Frontend tooling |
| Rust stable (MSVC toolchain) | `rustup default stable-msvc` |
| Microsoft C++ Build Tools | Component *MSVC v143 x64/x86 build tools* |
| Windows 10/11 SDK | Desktop C++ x64 libraries |
| WebView2 runtime | Present on Windows 11 and most Windows 10 installs |

The Rust toolchain, build tools and SDK can be installed outside `C:` (for example with `winget install Microsoft.VisualStudio.2022.BuildTools --override "--installPath E:\BuildTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64"` and `rustup-init` with `CARGO_HOME`/`RUSTUP_HOME` set).

```powershell
pnpm install
pnpm tauri dev          # Vite dev server + debug app with hot reload
```

Set `SANCTUARYFLOW_DATA_DIR` to use a separate library folder (and a separate WebView2 profile) while developing.

## Architecture

```
┌──────────── Operator window (React) ────────────┐      ┌──── Projector window (React) ────┐
│ pages · presentation engine (pure state machine) │      │ SlideRenderer (same component)   │
│ slide generation · reference parser · sync engine│      │ renders only what it is sent     │
└───────────────┬──────────────────────────────────┘      └───────────────▲──────────────────┘
                │ invoke (typed commands)                                  │ local event
┌───────────────▼──────────────── Tauri app (src-tauri) ──────────────────┴──────────────────┐
│ commands · PresentationHub (in-memory state + recovery file) · display manager & watcher    │
│ eBible provider · DPAPI secret store · scheduled backups · capabilities (least privilege)    │
└───────────────┬─────────────────────────────────────────────────────────────────────────────┘
                │ blocking pool
┌───────────────▼──────────────── sanctuary-core (Rust, no Tauri) ────────────────────────────┐
│ SQLite (WAL, writer + read pool, FTS5) · migrations · repositories · Bible import adapters  │
│ (JSON/CSV/OSIS/USFM/USX) + validation · media · backup/restore · sync outbox & conflicts    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **The local library is the source of truth.** SQLite in WAL mode with one writer connection and a small read-only pool, so long imports never block lookups. Every multi-record change runs in a transaction. Migrations are append-only, checksummed and refuse to open a database from a newer version; an existing database is copied to `backups/` before it is upgraded.
- **The Rust core has no Tauri dependency**, so `cargo test -p sanctuary-core` is fast. TypeScript types for every command payload are generated from the Rust structs with ts-rs (`pnpm bindings`, output in `src/types/generated`).
- **Presentation never waits on IO or the network.** Navigation is a pure state machine in the operator window. Each change produces a self-contained render state (slide, resolved theme, media URLs) that the Rust `PresentationHub` keeps in memory, forwards to the projector window as a local event, and writes to a recovery file on a background thread. The projector asks for the latest state when it loads, so a reloaded projector shows the current slide.
- **One renderer** (`SlideRenderer`) draws previews and the projector on a logical canvas 1080 units tall at the output's aspect ratio, so text fits the same way everywhere. Text shrinks to fit the safe area.
- **Live Canva designs** are framed from their public embed address in a sandboxed, click-through iframe; changing only the `#page` fragment turns pages without a reload. Canva centres the design and draws its page bar along the bottom ~90 px of its viewer, so the viewer is made `CANVA_BAR_SPACE` taller above and below the design and clipped to it (`canvaFrame` in `src/lib/canva.ts`). Thumbnails are pictures of the pages taken by WebView2 (`CapturePreview`) in a hidden, muted window outside every display that no capability names (`src-tauri/src/canva_capture.rs`), cropped the same way and stored as slide pictures in the item's `canvaPictures` (`src/features/services/canvaPictures.tsx`).
- **Displays** are native windows managed in Rust. A watcher polls the display configuration; if the projector's display disappears, the output is hidden (never moved onto the operator screen) and restored when it returns.
- **Bible content integrity:** the catalog lives in `shared/bible/canon-protestant.json` and is used by both Rust and TypeScript. Imports are parsed into a common model, validated (book coverage, chapter counts, duplicates/overlaps, gaps, empty verses, out-of-catalog books) and written in a single transaction with a job record and a stored validation report. Combined verses keep their source numbering (`verse`–`verse_end`). Nothing is silently dropped: excluded content must be acknowledged.
- **Security:** commands are allow-listed per window by generated permission sets (`build.rs`); the projector window can only read presentation state and report playback. Media is served through the asset protocol from the managed media folder only, with stored paths checked against traversal. SQL is always parameterized; full-text queries are built from quoted tokens. Cloud tokens are encrypted with DPAPI. The CSP allows scripts only from the app.

## Data model

Tables (see `crates/sanctuary-core/migrations/0001_initial.sql`): `app_settings`, `device_metadata`, `bible_canons`, `bible_books`, `bible_canon_books`, `bible_translations`, `bible_translation_books`, `bible_verses` (+ `bible_verses_fts`), `bible_import_jobs`, `bible_validation_reports`, `scripture_passages`, `songs`, `song_sections`, `song_tags` (+ `songs_fts`), `presentation_themes`, `custom_slides`, `media_assets`, `service_plans`, `service_items`, `sync_outbox`, `sync_metadata`, `sync_conflicts`, `backup_history`.

Synchronized aggregates (songs, service plans, themes, slide decks, media metadata) carry `revision`, `synced_revision`, `remote_version` and `deleted_at`.

## Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Rust core | `cargo test -p sanctuary-core` | catalog (66/39/27 books, 1,189 chapters), migrations, songs, services, themes, slides, media validation, every Bible format, validation statuses, transactional rollback, search, backup/restore, sync outbox/conflicts |
| Rust app | `cargo test -p sanctuaryflow` | DPAPI secret store, eBible catalog filtering |
| Frontend | `pnpm test` | reference parser, slide generation, presentation engine, themes, keyboard, sync engine (offline, retry, idempotency, conflicts, deletions, auth failure) |
| End-to-end | `pnpm test:e2e` | launches the real app with a temporary library and drives both windows over the WebView2 debugging port |

The end-to-end harness (`tests/e2e/app.ts`) starts `target/debug/sanctuaryflow.exe` with `SANCTUARYFLOW_DATA_DIR` and `SANCTUARYFLOW_E2E_DEBUG_PORT` (the debug port is compiled into debug builds only). Optional suites:

- `SANCTUARYFLOW_E2E_NETWORK=1` — downloads and imports the World English Bible from eBible.org.
- `SANCTUARYFLOW_TOUR_DIR=<folder>` — saves screenshots of every page.
- `SANCTUARYFLOW_E2E_EXE=<path>` — runs against another build, for example `pnpm tauri build --debug --no-bundle` (bundled frontend, production CSP).
- `SANCTUARYFLOW_BIBLE_FIXTURE=<file>` with `cargo test -p sanctuary-core external_fixture -- --nocapture` validates any real Bible source.

Avoid clicking in the test windows while the suite runs; they are real windows on the desktop.

## Release

```powershell
pnpm tauri build
```

Produces `target/release/bundle/nsis/SanctuaryFlow_<version>_x64-setup.exe` (per-user install, embedded WebView2 bootstrapper). For machines without internet that lack WebView2, change `bundle.windows.webviewInstallMode` to `offlineInstaller` (adds about 130 MB). Code signing is not configured; sign the installer with your certificate (`bundle.windows.certificateThumbprint` or `signCommand`) to avoid SmartScreen warnings.

### Welcome, Home insights and Metallic Gold

- **First start:** `src/features/welcome/Welcome.tsx` shows while `general.onboardingDone` is not `true` (seeded `false`); it saves `general.userName` and optionally `general.churchName`. `Greeting` waits for it (`welcomePending`) and greets with `greetingTitle(part, name)`. Under end-to-end tests it is hidden unless `SANCTUARYFLOW_E2E_WELCOME=1` (Rust injects `window.__SANCTUARYFLOW_E2E_WELCOME__`, like the greeting).
- **Home insights** come from `dashboard::summary` (`crates/sanctuary-core/src/dashboard.rs`): `servicesByMonth` (four months back to next month, templates excluded), `songsByMonth` (six months), `topSongs` (by `use_count`), `itemMix` (service items by type, headings and blanks excluded), `songUses` and `scriptureUses`. Home refetches on every visit. Charts are plain HTML/SVG in one gold hue with value labels and hover tooltips.
- **Metallic Gold** (`THEME_METALLIC_GOLD`, `...0009`) is the seeded song default; background style `metallic-gold` in `BACKGROUND_STYLES` (`src/lib/theme.ts`). Migration 0008 moves libraries whose song default is a built-in theme (or none) to it.
- **Transition preview:** `SlideRenderer` takes `animate` to play the theme's transition outside the output; the theme editor alternates between two sample slides to show it.
- **Display font:** `--font-display` (`font-display` class) is Playfair Display Variable, bundled from `@fontsource-variable/playfair-display` (offline).
