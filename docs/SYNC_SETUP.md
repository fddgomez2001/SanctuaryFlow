# Cloud synchronization setup

Synchronization is optional. SanctuaryFlow keeps working fully offline; synchronization only shares content between computers when they are online.

**What synchronizes:** songs, service plans (and templates), slide decks, themes, and media titles/tags.
**What does not:** Bible text (licenses differ per translation — install translations on each computer), media files themselves (import the same file on each computer; it is matched by content), settings, and live slide changes. **Music stays on each computer:** audio files are never uploaded (not even their names), and a song's music, album cover and lyric timings are left out of the song that is shared, so another computer's changes to the song keep this computer's music.

## 1. Create the Supabase project

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor** and run each file in [`supabase/migrations/`](../supabase/migrations/) in name order (oldest first), or use the Supabase CLI: `supabase db push`. Every file is safe to run on a project that already has the earlier ones.
3. Under **Authentication → Providers**, keep *Email* enabled. Decide whether new accounts must confirm their email.
4. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.

Never put the **service_role** key into SanctuaryFlow. The app refuses it, and it is not needed.

## 2. Connect each computer

On each computer, open **Synchronization** and:

1. Paste the project URL and anon key and click **Save project**.
2. **Create account** (first time) or **Sign in**. The sign-in session is encrypted with Windows DPAPI for the current Windows user.
3. The first person creates a **workspace** for the church. Owners can create **invite codes** for editors (can change content) or viewers (read only); others join with the code.
4. Turn on **Synchronize this computer**. Existing local content is queued and uploaded.

The app synchronizes every two minutes, whenever the network returns, and on **Sync now**.

## 3. How it works

- Every local change is written to the local library immediately and to an **outbox**. Newer edits to the same item replace an unsent one.
- Uploads call `sync_push`, which applies a change only if the server version is the one the change was based on (compare-and-swap). Each upload has an operation id, so a retry after a dropped connection is never applied twice.
- Downloads call `sync_pull` with a cursor and apply changes in order. A remote change is applied directly only when the item has no unsent local edits.
- When two computers changed the same item, it is listed under **Conflicts**. Choose *Keep mine* (upload yours over theirs), *Keep theirs*, or *Keep both* (yours becomes a copy).
- Deletions are recorded as tombstones, so they synchronize too.
- Failed uploads are retried with exponential backoff (30 seconds up to 6 hours). A network outage stops the run and leaves everything queued.

## 4. Security

- Row Level Security is enabled on every table. Members can read only the workspaces they belong to.
- There are no direct insert/update/delete policies. All writes go through `SECURITY DEFINER` functions that check membership and role (`owner`, `editor`, `viewer`).
- Only authenticated users can call the functions; the anon role cannot.
- Items larger than 4 MB are rejected.

## 5. Self-hosted Supabase

The app's Content Security Policy allows connections to `https://*.supabase.co`. To use a self-hosted Supabase on another domain, add that origin to `connect-src` in `src-tauri/tauri.conf.json` and rebuild.
