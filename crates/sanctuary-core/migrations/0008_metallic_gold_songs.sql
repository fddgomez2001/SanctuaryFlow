-- Songs now show white Arial on metallic gold by default (the built-in
-- "Metallic Gold" theme, seeded on start). Libraries whose song default is
-- still one of the built-in themes switch once; a library that chose a theme
-- of its own keeps it. Themes → "Default for: Songs" switches back.
UPDATE app_settings
SET value = '"00000000-0000-4000-8000-000000000009"'
WHERE key = 'presentation.defaultSongThemeId'
  AND (value = 'null' OR value LIKE '"00000000-0000-4000-8000-00000000000_"');
