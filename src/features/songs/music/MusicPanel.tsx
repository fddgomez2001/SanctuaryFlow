import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ImagePlus, Music2, Timer, X } from "lucide-react";
import type { Song } from "@/types/generated/Song";
import type { SongDocument } from "@/types/generated/SongDocument";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useMediaRefs } from "@/hooks/useThemes";
import { activeLineIndex, lyricsChangedSinceSync, timedCount } from "@/lib/music/sync";
import { MediaPickerDialog } from "@/features/services/pickers";
import { cn } from "@/lib/cn";
import { ArtistCover, artistKey, NO_ARTIST, useArtistCovers } from "../artists";
import { songToDocument } from "../SongEditor";
import { PlayerBar } from "./PlayerBar";
import { SyncEditor } from "./SyncEditor";
import { useAudio } from "./useAudio";

/** Saves a change to a song's music details. */
async function saveMusic(song: Song, patch: Partial<SongDocument>) {
  return api.songs.save({ ...songToDocument(song), ...patch });
}

/**
 * The song's recording and album cover, a player, and its lyrics following
 * the music once they are synchronized.
 */
export function MusicPanel({
  song,
  autoPlay,
  onPrevious,
  onNext,
}: {
  song: Song;
  autoPlay?: boolean;
  onPrevious?: () => void;
  onNext?: (autoPlay: boolean) => void;
}) {
  const qc = useQueryClient();
  const covers = useArtistCovers();
  const [picking, setPicking] = useState<null | "audio" | "cover">(null);
  const [syncing, setSyncing] = useState(false);
  const refs = useMediaRefs([song.audioMediaId, song.coverMediaId].filter((x): x is string => !!x));
  const audioAsset = useQuery({ queryKey: ["media-asset", song.audioMediaId], queryFn: () => api.media.get(song.audioMediaId!), enabled: !!song.audioMediaId, retry: false });
  const audioRef = song.audioMediaId ? refs.data?.[song.audioMediaId] : undefined;
  const missing = !!song.audioMediaId && (audioAsset.isError || audioAsset.data?.missing === true);
  const audio = useAudio(syncing ? null : (audioRef?.url ?? null), { autoPlay, onEnded: () => onNext?.(true) });
  const coverUrl = (song.coverMediaId && refs.data?.[song.coverMediaId]?.url) || covers.coverUrl(artistKey(song.artist));
  const coverIsDefault = !song.coverMediaId && covers.isDefault(coverUrl);
  const lines = song.lyricSync ?? [];
  const timed = timedCount(lines);
  const active = activeLineIndex(lines, audio.time * 1000);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  const update = async (patch: Partial<SongDocument>, message: string) => {
    try {
      const saved = await saveMusic(song, patch);
      qc.setQueryData(["song", song.id], saved);
      void qc.invalidateQueries({ queryKey: ["songs"] });
      toast.success(message);
    } catch (e) {
      toast.error("The song could not be saved", e);
    }
  };

  return (
    <section className="mb-5 rounded-lg border border-border bg-panel p-4" aria-label="Music">
      <div className="flex flex-wrap items-start gap-4">
        <div className="group relative">
          {coverUrl ? (
            <img src={coverUrl} alt="" className={cn("size-28 rounded-md shadow", coverIsDefault ? "bg-[#0d0f13] object-contain p-2" : "object-cover")} />
          ) : (
            <ArtistCover name={song.artist?.trim() || NO_ARTIST} url={null} size="xl" className="!size-28 !text-3xl" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Music2 className="size-4 text-primary" />
            <span className="text-sm font-semibold">Music</span>
            <span className="truncate text-xs text-subtle">
              {song.audioMediaId ? (audioAsset.data?.originalFilename ?? "Music file") : "No music file yet"}
              {song.audioMediaId && lines.length > 0 && ` · ${timed} of ${lines.length} lines synchronized`}
            </span>
          </div>
          {song.audioMediaId && !missing && <PlayerBar audio={audio} onPrevious={onPrevious} onNext={onNext ? () => onNext(audio.playing) : undefined} />}
          {missing && (
            <p className="flex items-center gap-2 text-sm text-warning">
              <CircleAlert className="size-4" /> The music file is missing from the library. Choose it again.
            </p>
          )}
          {audio.error && <p className="text-sm text-danger">{audio.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={song.audioMediaId ? "secondary" : "primary"} icon={<Music2 className="size-3.5" />} onClick={() => setPicking("audio")}>
              {song.audioMediaId ? "Change music…" : "Add music (MP3)…"}
            </Button>
            {song.audioMediaId && (
              <Button size="sm" icon={<Timer className="size-3.5" />} onClick={() => setSyncing(true)}>
                {timed ? "Edit lyric timing…" : "Sync lyrics…"}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking("cover")}>
              {song.coverMediaId ? "Change album cover…" : "Album cover…"}
            </Button>
            {song.coverMediaId && (
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => void update({ coverMediaId: null }, "Album cover removed")}>
                Remove cover
              </Button>
            )}
            {song.audioMediaId && (
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => void update({ audioMediaId: null }, "Music removed from the song")}>
                Remove music
              </Button>
            )}
          </div>
          {lyricsChangedSinceSync(song) && (
            <p className="text-xs text-warning">The lyrics changed since they were synchronized. Open “Edit lyric timing…” and press “Rebuild from lyrics”; matching lines keep their times.</p>
          )}
        </div>
      </div>

      {timed > 0 && song.audioMediaId && !missing && (
        <div ref={list} className="mt-4 max-h-72 overflow-y-auto rounded-md bg-bg p-3" aria-label="Synchronized lyrics">
          {lines.map((line, i) => {
            const newSection = i === 0 || lines[i - 1]!.section !== line.section;
            return (
              <div key={line.id}>
                {newSection && line.section && <p className="mt-2 mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase first:mt-0">{line.section}</p>}
                <button
                  type="button"
                  aria-current={i === active ? "true" : undefined}
                  disabled={line.startMs == null}
                  onClick={() => line.startMs != null && audio.seek(line.startMs / 1000)}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left transition-all duration-200",
                    i === active ? "bg-primary/15 text-lg font-semibold text-text" : "text-muted hover:text-text",
                  )}
                >
                  {line.text}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <MediaPickerDialog
        open={picking !== null}
        kind={picking === "audio" ? "audio" : "image"}
        title={picking === "audio" ? `Music for “${song.title}”` : `Album cover for “${song.title}”`}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          const which = picking;
          setPicking(null);
          if (which === "audio") void update({ audioMediaId: m.id }, "Music added to the song");
          else void update({ coverMediaId: m.id }, "Album cover set");
        }}
      />
      {syncing && audioRef && <SyncEditor song={song} audioUrl={audioRef.url} onClose={() => setSyncing(false)} />}
    </section>
  );
}
