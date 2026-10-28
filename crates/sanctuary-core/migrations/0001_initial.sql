-- SanctuaryFlow initial schema.
-- Timestamps are ISO-8601 UTC strings. Entity ids are UUID strings.
-- Synchronized aggregates carry revision / synced_revision / remote_version / deleted_at.

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE device_metadata (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Bible: canonical catalog (independent of any translation's text)
-- ---------------------------------------------------------------------------

CREATE TABLE bible_canons (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  is_builtin   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bible_books (
  id             TEXT PRIMARY KEY,          -- USFM book code, e.g. GEN, 1CO
  osis_id        TEXT NOT NULL UNIQUE,      -- OSIS book id, e.g. Gen, 1Cor
  name           TEXT NOT NULL,
  testament      TEXT NOT NULL CHECK (testament IN ('OT', 'NT', 'DC')),
  abbreviations  TEXT NOT NULL DEFAULT '[]', -- JSON array
  aliases        TEXT NOT NULL DEFAULT '[]'  -- JSON array
);

CREATE TABLE bible_canon_books (
  canon_id       TEXT NOT NULL REFERENCES bible_canons(id) ON DELETE CASCADE,
  book_id        TEXT NOT NULL REFERENCES bible_books(id),
  book_order     INTEGER NOT NULL,
  chapter_count  INTEGER NOT NULL CHECK (chapter_count > 0),
  PRIMARY KEY (canon_id, book_id),
  UNIQUE (canon_id, book_order)
);

-- ---------------------------------------------------------------------------
-- Bible: translations and their text
-- ---------------------------------------------------------------------------

CREATE TABLE bible_translations (
  id                        TEXT PRIMARY KEY,
  code                      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                      TEXT NOT NULL,
  language                  TEXT NOT NULL,
  canon_id                  TEXT NOT NULL REFERENCES bible_canons(id),
  versification             TEXT,
  text_direction            TEXT NOT NULL DEFAULT 'ltr' CHECK (text_direction IN ('ltr', 'rtl')),
  publisher                 TEXT,
  source_provider           TEXT,
  source_url                TEXT,
  source_format             TEXT,
  license_name              TEXT,
  license_url               TEXT,
  copyright_notice          TEXT,
  attribution_text          TEXT,
  -- Permission flags: NULL = unknown, 0 = not permitted, 1 = permitted.
  offline_permitted         INTEGER,
  redistribution_permitted  INTEGER,
  modification_permitted    INTEGER,
  downloaded_at             TEXT,
  imported_at               TEXT,
  last_validated_at         TEXT,
  import_status             TEXT NOT NULL DEFAULT 'pending'
                              CHECK (import_status IN ('pending', 'importing', 'imported', 'failed')),
  validation_status         TEXT NOT NULL DEFAULT 'not_validated'
                              CHECK (validation_status IN ('not_validated', 'complete', 'incomplete', 'invalid')),
  book_count                INTEGER NOT NULL DEFAULT 0,
  chapter_count             INTEGER NOT NULL DEFAULT 0,
  verse_count               INTEGER NOT NULL DEFAULT 0,
  notes                     TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE TABLE bible_translation_books (
  translation_id  TEXT NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
  book_id         TEXT NOT NULL REFERENCES bible_books(id),
  name            TEXT NOT NULL,
  abbreviation    TEXT,
  book_order      INTEGER NOT NULL,
  chapter_count   INTEGER NOT NULL,
  verse_count     INTEGER NOT NULL,
  PRIMARY KEY (translation_id, book_id)
);

CREATE TABLE bible_import_jobs (
  id                TEXT PRIMARY KEY,
  translation_id    TEXT,
  translation_code  TEXT NOT NULL,
  source_kind       TEXT NOT NULL CHECK (source_kind IN ('file', 'provider')),
  source_format     TEXT NOT NULL,
  source_path       TEXT,
  source_provider   TEXT,
  source_checksum   TEXT,
  status            TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  verses_imported   INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT
);

-- One row per verse as numbered by the source. A source that combines verses
-- (e.g. "1-2") is stored once at the first verse with verse_end set, so no
-- source verse is renumbered or duplicated.
CREATE TABLE bible_verses (
  id              INTEGER PRIMARY KEY,
  translation_id  TEXT NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
  book_id         TEXT NOT NULL REFERENCES bible_books(id),
  chapter         INTEGER NOT NULL CHECK (chapter > 0),
  verse           INTEGER NOT NULL CHECK (verse >= 0),
  verse_end       INTEGER CHECK (verse_end IS NULL OR verse_end > verse),
  text            TEXT NOT NULL,
  source_ref      TEXT,
  import_job_id   TEXT REFERENCES bible_import_jobs(id) ON DELETE SET NULL,
  UNIQUE (translation_id, book_id, chapter, verse)
);

CREATE VIRTUAL TABLE bible_verses_fts USING fts5(
  text,
  content = 'bible_verses',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER bible_verses_ai AFTER INSERT ON bible_verses BEGIN
  INSERT INTO bible_verses_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER bible_verses_ad AFTER DELETE ON bible_verses BEGIN
  INSERT INTO bible_verses_fts (bible_verses_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER bible_verses_au AFTER UPDATE OF text ON bible_verses BEGIN
  INSERT INTO bible_verses_fts (bible_verses_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO bible_verses_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE bible_validation_reports (
  id              TEXT PRIMARY KEY,
  translation_id  TEXT REFERENCES bible_translations(id) ON DELETE CASCADE,
  import_job_id   TEXT REFERENCES bible_import_jobs(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'invalid')),
  summary         TEXT NOT NULL, -- JSON object
  issues          TEXT NOT NULL  -- JSON array
);
CREATE INDEX idx_bible_validation_reports_translation ON bible_validation_reports (translation_id, created_at);

-- Recently used and favorite passages.
CREATE TABLE scripture_passages (
  id              TEXT PRIMARY KEY,
  passage_key     TEXT NOT NULL UNIQUE, -- normalized "JHN 3:16-3:17"
  reference       TEXT NOT NULL,        -- display text
  translation_id  TEXT,
  book_id         TEXT NOT NULL REFERENCES bible_books(id),
  chapter         INTEGER NOT NULL,
  verse_start     INTEGER,
  chapter_end     INTEGER,
  verse_end       INTEGER,
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_scripture_passages_recent ON scripture_passages (last_used_at);

-- ---------------------------------------------------------------------------
-- Songs
-- ---------------------------------------------------------------------------

CREATE TABLE songs (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  artist            TEXT,
  original_key      TEXT,
  tempo             TEXT,
  language          TEXT,
  category          TEXT,
  copyright_holder  TEXT,
  copyright_year    TEXT,
  ccli_number       TEXT,
  source            TEXT,
  license           TEXT,
  notes             TEXT,
  arrangement       TEXT,              -- JSON array of section ids, NULL = section order
  theme_id          TEXT,
  is_favorite       INTEGER NOT NULL DEFAULT 0,
  use_count         INTEGER NOT NULL DEFAULT 0,
  last_used_at      TEXT,
  archived_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  revision          INTEGER NOT NULL DEFAULT 1,
  synced_revision   INTEGER NOT NULL DEFAULT 0,
  remote_version    INTEGER
);
CREATE INDEX idx_songs_title ON songs (title COLLATE NOCASE);
CREATE INDEX idx_songs_recent ON songs (last_used_at);

CREATE TABLE song_sections (
  id        TEXT PRIMARY KEY,
  song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('intro', 'verse', 'prechorus', 'chorus', 'bridge',
                                          'interlude', 'tag', 'outro', 'ending', 'custom')),
  label     TEXT NOT NULL,
  position  INTEGER NOT NULL,
  lyrics    TEXT NOT NULL
);
CREATE INDEX idx_song_sections_song ON song_sections (song_id, position);

CREATE TABLE song_tags (
  song_id  TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (song_id, tag)
);
CREATE INDEX idx_song_tags_tag ON song_tags (tag);

CREATE VIRTUAL TABLE songs_fts USING fts5(
  song_id UNINDEXED,
  title,
  artist,
  lyrics,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ---------------------------------------------------------------------------
-- Themes, custom slides, media
-- ---------------------------------------------------------------------------

CREATE TABLE presentation_themes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'general'
                     CHECK (category IN ('general', 'song', 'scripture', 'announcement')),
  is_builtin       INTEGER NOT NULL DEFAULT 0,
  settings         TEXT NOT NULL, -- JSON ThemeSettings
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  revision         INTEGER NOT NULL DEFAULT 1,
  synced_revision  INTEGER NOT NULL DEFAULT 0,
  remote_version   INTEGER
);

-- A custom slide deck (announcements, sermon slides, free-form slides).
CREATE TABLE custom_slides (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'custom'
                     CHECK (category IN ('announcement', 'sermon', 'custom', 'template')),
  theme_id         TEXT,
  slides           TEXT NOT NULL DEFAULT '[]', -- JSON array of slide documents
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  revision         INTEGER NOT NULL DEFAULT 1,
  synced_revision  INTEGER NOT NULL DEFAULT 0,
  remote_version   INTEGER
);

CREATE TABLE media_assets (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  title              TEXT NOT NULL,
  original_filename  TEXT NOT NULL,
  stored_path        TEXT NOT NULL, -- relative to the managed media directory
  mime_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  duration_ms        INTEGER,
  checksum_sha256    TEXT NOT NULL,
  thumbnail_path     TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  synced_revision    INTEGER NOT NULL DEFAULT 0,
  remote_version     INTEGER
);
CREATE INDEX idx_media_assets_checksum ON media_assets (checksum_sha256);

-- ---------------------------------------------------------------------------
-- Service plans
-- ---------------------------------------------------------------------------

CREATE TABLE service_plans (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  service_date     TEXT,  -- YYYY-MM-DD
  service_time     TEXT,  -- HH:MM
  description      TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'ready', 'completed', 'archived')),
  is_template      INTEGER NOT NULL DEFAULT 0,
  theme_id         TEXT,
  last_opened_at   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  revision         INTEGER NOT NULL DEFAULT 1,
  synced_revision  INTEGER NOT NULL DEFAULT 0,
  remote_version   INTEGER
);
CREATE INDEX idx_service_plans_date ON service_plans (service_date);

CREATE TABLE service_items (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES service_plans(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  item_type   TEXT NOT NULL CHECK (item_type IN ('song', 'scripture', 'announcement', 'sermon', 'image',
                                                 'video', 'custom', 'heading', 'blank')),
  title       TEXT NOT NULL,
  ref_id      TEXT,
  settings    TEXT NOT NULL DEFAULT '{}', -- JSON, item-type specific
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_service_items_plan ON service_items (plan_id, position);

-- ---------------------------------------------------------------------------
-- Synchronization
-- ---------------------------------------------------------------------------

CREATE TABLE sync_outbox (
  id                   TEXT PRIMARY KEY, -- operation id, used for idempotent upload
  entity_type          TEXT NOT NULL,
  entity_id            TEXT NOT NULL,
  operation            TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  local_revision       INTEGER NOT NULL,
  base_remote_version  INTEGER,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'failed', 'conflict', 'done')),
  retry_count          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at      TEXT,
  last_error           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
-- At most one open operation per entity; newer local edits replace it.
CREATE UNIQUE INDEX idx_sync_outbox_open ON sync_outbox (entity_type, entity_id) WHERE status != 'done';

CREATE TABLE sync_metadata (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE sync_conflicts (
  id               TEXT PRIMARY KEY,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  local_payload    TEXT,
  remote_payload   TEXT,
  remote_version   INTEGER NOT NULL,
  remote_deleted   INTEGER NOT NULL DEFAULT 0,
  detected_at      TEXT NOT NULL,
  resolved_at      TEXT,
  resolution       TEXT CHECK (resolution IN ('keep_local', 'keep_remote', 'keep_both'))
);
CREATE INDEX idx_sync_conflicts_open ON sync_conflicts (entity_type, entity_id) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Backups
-- ---------------------------------------------------------------------------

CREATE TABLE backup_history (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('manual', 'scheduled', 'pre_restore', 'pre_migration')),
  path           TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  include_media  INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error_message  TEXT
);
