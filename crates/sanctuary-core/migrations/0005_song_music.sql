-- Music for songs: a recording, an album cover and the lyric timings that
-- make the words follow the recording (JSON array of timed lines).
ALTER TABLE songs ADD COLUMN audio_media_id TEXT;
ALTER TABLE songs ADD COLUMN cover_media_id TEXT;
ALTER TABLE songs ADD COLUMN lyric_sync TEXT;
