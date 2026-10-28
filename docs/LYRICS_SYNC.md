# Music and synchronized lyrics

How SanctuaryFlow stores a song's music, times its lyrics, and shows them on the output.

## Data

Migration `0005_song_music.sql` adds three columns to `songs`. No new tables were needed.

| Column | Meaning |
| --- | --- |
| `audio_media_id` | The recording: an audio file in the media library (MP3, M4A, AAC, WAV, OGG, Opus or FLAC; type checked by file signature, like every media import). |
| `cover_media_id` | The album cover picture. Without one, the artist's cover (Song Library → artist → *Add cover picture…*) is used. |
| `lyric_sync` | JSON array of timed lines, in the order they are sung. |

A timed line (`LyricLine` in `crates/sanctuary-core/src/songs.rs`):

```json
{ "id": "3f2c…:0:1", "section": "Chorus", "text": "A line of the chorus", "startMs": 12000, "endMs": null }
```

- Times are milliseconds from the start of the recording. `startMs: null` means the line has not been timed yet.
- `endMs` is optional. Without it a line lasts until the next timed line starts. Set it to leave a gap, for example before an instrumental part.
- Lines follow the song's presentation order, so a chorus sung three times appears three times, each with its own times.
- Saving checks the lines: at most 3000, at most 500 characters each, times within a day, and an end never before its start. Empty lines are dropped and duplicate ids are replaced.

## Stays on this computer

Music is local only. Cloud synchronization (Supabase) never uploads:

- audio files. No media file is uploaded; for audio, not even its details (name, size) are sent.
- a song's `audioMediaId`, `coverMediaId` or `lyricSync`. They are removed from the uploaded song.

When another computer changes the song, its update is applied and this computer's music, cover and timings are kept. See `upload_payload`, `is_local_only` and `write_remote` in `crates/sanctuary-core/src/sync.rs`, and the test `music_stays_on_this_computer`.

Local backups (Backup & Restore) do include the audio files and the timings.

## Timing the lyrics (manual)

Song Library → song → *Music* → **Sync lyrics…** (`src/features/songs/music/SyncEditor.tsx`):

- **Tap** (or T / Enter) stamps the current playback position as the start of the highlighted line and moves to the next. Space plays and pauses. **End line here** (E) ends the line being sung.
- Times can be typed (`1:23.45`, `83.45` or `1:23`). Clicking a line's ▶ plays from it, and clicking the timeline jumps.
- Lines can be split at the cursor, added, moved and deleted.
- **Preview** shows what the audience sees. **Save timing** stores it, and **Undo changes** returns to the saved timing.
- **Rebuild from lyrics** makes the lines match the song's current lyrics. Lines that are still there keep their times: the same line in the same place first, then the same words elsewhere (`mergeTimings` in `src/lib/music/sync.ts`).

## On the output

When a song with music is live, the Live page shows **Song music** controls: play/pause, previous/next line, position, volume, speed, and the view.

- The output window owns the audio element and reports its position back to the operator about four times a second (`MusicStage` in `src/components/slide/MusicStage.tsx`).
- The operator's preview follows those reports, so both show the same line.
- **Vinyl**: the cover as the record sleeve, with title and artist in Outfit. The record behind it turns clockwise (33⅓ rpm) only while the music plays, and the cover is its label. The current line and the next one are shown below.
- **Lyrics**: the current line very large, with the next line under it.
- **Full song**: every line, scrolling so the line being sung stays in the middle.
- **Slides**: the song's normal slides, while the music keeps playing.
- Lyric size, alignment and the view shown when the music starts are set in Settings → Presentation → Music.

## Automatic alignment (not built in)

Lines could be timed automatically by a forced aligner that listens to the recording and matches it to the supplied words, for example a Whisper-based aligner run on this computer. Nothing like that ships with SanctuaryFlow, and the editor never guesses times. If one is added:

- **Keep it separate from playback.** Run it as a background job (a Rust command or a separate process) that receives the audio file path and the current lines, and returns `startMs`/`endMs` per line with a confidence.
- **Load results as a draft.** Put them into the Sync editor as unsaved changes, so the operator reviews and corrects them before **Save timing**. Low-confidence lines should be left untimed.
- **Expect the hard cases.** Repeated choruses, instrumental parts, background vocals and words sung differently from the lyrics will need correcting. Matching should follow the presentation order rather than search for words anywhere.
- **Report success honestly.** Only report success once times were produced and saved.

## AI music generation (not built in)

No music-generation service is integrated, and no provider or endpoint is assumed. A provider could be added later as an optional backend command:

- API keys are kept in the DPAPI secure store (`secure_store.rs`) and used only by Rust, never by the web UI.
- The command submits prompt, style and lyrics as the provider supports, and polls for status.
- A finished file is imported like any other audio file, and only if the provider's terms allow keeping it.

Uploaded music works without any of this.

## Tests

- `crates/sanctuary-core/src/songs.rs`: `songs_keep_their_music_and_timed_lyrics` checks validation and round trips.
- `crates/sanctuary-core/src/sync.rs`: `music_stays_on_this_computer` checks that music is never uploaded and that remote changes keep it.
- `tests/unit/music-sync.test.ts`: lines in sung order, keeping times through lyric edits, the active line, and time formats.
- `tests/e2e/music.e2e.ts`: adds music and a cover, times lines by tapping, plays with the highlighted line, then presents with the vinyl turning while playing (and stopping when paused), next line, and the views. It uses a generated tone and placeholder lyrics.

## Not done

- Upload and edit permissions: SanctuaryFlow has no local sign-in, so whoever uses the computer can add music and edit timings. The cloud workspace roles (owner/editor/viewer) only govern what is shared through Supabase, and music is not shared.
