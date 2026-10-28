-- Pictures made from imported presentations (PDF pages, PowerPoint slides)
-- belong to their slide deck and are not listed in the Media Library.
ALTER TABLE media_assets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'library'
  CHECK (purpose IN ('library', 'slide'));

-- Earlier imports: full-slide pictures named "<file> - page N" or
-- "<file> - slide N" that are the whole background of a slide with nothing
-- else on it.
UPDATE media_assets SET purpose = 'slide'
WHERE (title GLOB '* - page [0-9]*' OR title GLOB '* - slide [0-9]*')
  AND id IN (
    SELECT json_extract(s.value, '$.background.mediaId')
    FROM custom_slides d, json_each(CASE WHEN json_valid(d.slides) THEN d.slides ELSE '[]' END) s
    WHERE d.deleted_at IS NULL
      AND json_extract(s.value, '$.background.type') = 'image'
      AND json_array_length(COALESCE(json_extract(s.value, '$.elements'), '[]')) = 0
  );
