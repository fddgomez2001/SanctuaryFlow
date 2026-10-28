# SanctuaryFlow

SanctuaryFlow is a Windows desktop application for presenting worship services: song lyrics, Scripture, announcements, sermon slides, images and video on a projector or second screen.

It is **offline-first**. Songs, installed Bible translations, service plans, themes and media live in a local library on the computer, and everything needed during a service works without an internet connection. Cloud synchronization between computers is optional.

> SanctuaryFlow is an original product. It is not affiliated with EasyWorship or any other presentation software.

## Features

- **Song library** — sections (verse, chorus, bridge, …), custom presentation order with repeats, tags, categories, languages (including Filipino), copyright/CCLI details, favorites, archive, full-text search, JSON/CSV import and export with duplicate detection.
- **Bible library** — the 66-book Protestant catalog (1,189 chapters) with room for other canons; multiple translations side by side; reference parsing (`John 3:16`, `Ps 23`, `Rom 8:28-30`, `Gen 1:26-2:3`); offline full-text search; recent and favorite passages.
- **Bible import** — USFM (file, folder or zip), USX, OSIS XML, SanctuaryFlow JSON and CSV, plus authorized downloads from eBible.org. Every import is validated against the canon (missing books/chapters/verses, duplicates, versification differences), records its license, requires confirmation that offline storage is permitted, and runs in a single transaction.
- **Service planner** — drag-and-drop order of worship with songs, Scripture, announcements, sermon slides, images, videos, custom slides, headings and holding slides; templates; duplicate; export/import; automatic saving.
- **Dual-screen presentation** — an operator console and a separate full-screen projector window on the chosen display, with live and next previews, keyboard control, black / clear / logo screens, video playback controls, recovery after a restart, and handling of a disconnected projector.
- **Slide editor and themes** — text, image and shape slides; reusable templates; themes with fonts, colours, backgrounds (colour, image, video), overlays, safe margins, Scripture references, verse numbers, song footers, logos and fade transitions. Text automatically shrinks to fit.
- **Media library** — managed copies of images, videos and audio with signature validation, checksums, duplicate detection, thumbnails and missing-file detection.
- **Backup and restore** — complete `.sfbackup` archives (database snapshot plus optional media) with checksums, validation before restore, a safety backup, automatic rollback, and scheduled backups.
- **Optional synchronization** — Supabase Auth and PostgreSQL with Row Level Security, an offline outbox, idempotent uploads, retries with backoff, explicit conflict resolution and tombstones for deletions.

## Download

Download the newest Windows installer, **`SanctuaryFlow-Setup-x64.exe`**, from the [latest release](https://github.com/fddgomez2001/SanctuaryFlow/releases/latest) or from the SanctuaryFlow website. Each release lists the installer's SHA-256 and has a GitHub build attestation:

```powershell
Get-FileHash .\SanctuaryFlow-Setup-x64.exe
gh attestation verify SanctuaryFlow-Setup-x64.exe -R fddgomez2001/SanctuaryFlow
```

## Quick start (operators)

1. Run `SanctuaryFlow-Setup-x64.exe`. No administrator rights are needed.
2. Open SanctuaryFlow and follow the setup steps on the Home page.
3. Read the [User Guide](docs/USER_GUIDE.md) for running a Sunday service.

## Development

Requirements on Windows 10/11: Node.js 22+, pnpm 10, Rust (stable, MSVC toolchain), Microsoft C++ Build Tools with a Windows SDK, and the WebView2 runtime. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```powershell
pnpm install
pnpm tauri dev                 # run the app with hot reload
pnpm test                      # frontend unit tests (Vitest)
cargo test --workspace         # Rust tests (core engine + app)
pnpm test:e2e                  # end-to-end tests against the real app
pnpm tauri build               # release build and Windows installer
```

The installer is written to `target/release/bundle/nsis/`.

## Releases and the website

- **Releases are automatic.** `.github/workflows/release.yml` runs on every push to `main` that changes the app (not `website/` or `docs/`). It runs the type check and unit tests, builds the installer on Windows, attests it, and publishes it as `SanctuaryFlow-Setup-x64.exe` in the release named after the version in `src-tauri/tauri.conf.json`. Pushing without changing the version replaces that release's installer; change the version (also in `package.json` and `Cargo.toml`) to publish a new numbered release. It can also be started by hand from the Actions tab.
- **The website** is plain HTML in `website/` (no build step). On Vercel, import this repository and keep the default settings: `vercel.json` serves `website/`, skips the install and build of the desktop app, and sets security headers. Its Download buttons go to the site's own `/download`, which `vercel.json` forwards to `releases/latest/download/SanctuaryFlow-Setup-x64.exe`, so they always give the newest installer without redeploying the site. To see the site on this computer: `node scripts/serve-website.mjs`, then open http://localhost:4321.

## Project layout

```
crates/sanctuary-core/   Rust engine: SQLite schema and migrations, repositories, Bible import
                         and validation, media, backup/restore, sync outbox (no Tauri dependency)
src-tauri/               Desktop shell: commands, windows, displays, permissions, eBible provider,
                         DPAPI secret storage
src/                     React + TypeScript UI
  windows/operator/      operator console
  windows/presentation/  projector output window
  features/              pages (songs, bible, services, live, slides, media, themes, backup, sync, …)
  services/              typed command API and the presentation engine
  lib/                   pure logic: reference parsing, slide generation, themes, keyboard
shared/bible/            canonical book catalog shared by Rust and TypeScript
supabase/migrations/     optional cloud schema with Row Level Security
tests/                   unit, end-to-end and fixture files
docs/                    user, sync, format and developer documentation
```

## Content and licensing

SanctuaryFlow does not ship song lyrics or Bible text. Import only content you are licensed to use. Bible translations record their source, license and permissions, and incomplete translations are marked as such.

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Cloud synchronization setup](docs/SYNC_SETUP.md)
- [Import file formats](docs/FILE_FORMATS.md)
- [Development, architecture and testing](docs/DEVELOPMENT.md)
