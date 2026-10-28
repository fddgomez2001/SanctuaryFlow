-- Next (and the arrow keys) now stop on the last slide of each item, so the
-- output never moves on to the next song by accident. The old default let
-- Next continue into the next item; it can be turned back on in Settings.
UPDATE app_settings SET value = 'false' WHERE key = 'presentation.advanceAcrossItems';
