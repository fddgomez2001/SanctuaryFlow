-- Media Library folders: each file can belong to one folder (by name).
ALTER TABLE media_assets ADD COLUMN folder TEXT;
CREATE INDEX idx_media_assets_folder ON media_assets (folder);
