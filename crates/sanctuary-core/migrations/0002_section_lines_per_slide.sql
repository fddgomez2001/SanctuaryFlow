-- Per-section slide size: NULL uses the global "lyric lines per slide"
-- setting; 1 presents the section line by line (for example a chorus).
ALTER TABLE song_sections ADD COLUMN lines_per_slide INTEGER
  CHECK (lines_per_slide IS NULL OR lines_per_slide BETWEEN 1 AND 12);
