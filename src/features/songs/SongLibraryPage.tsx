import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, CalendarPlus, Copy, FileDown, FileUp, ImagePlus, MonitorPlay, Music, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import type { SongQuery } from "@/types/generated/SongQuery";
import type { SongDocument } from "@/types/generated/SongDocument";
import type { SongSummary } from "@/types/generated/SongSummary";
import { api } from "@/services/api";
import { useNav } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/misc";
import { confirm } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { SlideThumb } from "@/components/slide/SlideThumb";
import { setting, useSettings } from "@/hooks/useSettings";
import { useRenderTheme } from "@/hooks/useThemes";
import { useStoredState } from "@/hooks/useStoredState";
import { songToSlides } from "@/lib/slides/lyrics";
import { presentSong } from "@/services/presentation-engine/quick";
import { addToService } from "@/features/services/AddToServiceDialog";
import { MediaPickerDialog } from "@/features/services/pickers";
import { exportSongs, SongImportDialog } from "@/features/import-export/SongImportDialog";
import { cn } from "@/lib/cn";
import { defaultSongQuery } from "./query";
import { emptySong, SongEditor, songToDocument } from "./SongEditor";
import { type Artist, ArtistCover, artistKey, groupByArtist, NO_ARTIST, useAllSongs, useArtistCovers } from "./artists";
import { MusicPanel } from "./music/MusicPanel";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Tab = "artists" | "songs" | "favorites" | "archived";
type View = { kind: "none" } | { kind: "artist"; key: string } | { kind: "song"; id: string; fromArtist?: string; autoPlay?: boolean };

const TABS: { id: Tab; label: string }[] = [
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
  { id: "favorites", label: "Favorites" },
  { id: "archived", label: "Archived" },
];

export function SongLibraryPage() {
  const qc = useQueryClient();
  const params = useNav((s) => s.params);
  const [tab, setTab] = useStoredState<Tab>("songs.tab", "artists");
  const [text, setText] = useState("");
  const [view, setView] = useState<View>(params.songId ? { kind: "song", id: params.songId } : { kind: "none" });
  const [editing, setEditing] = useState<SongDocument | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const search = useDebounced(text.trim(), 200);
  const covers = useArtistCovers();
  const all = useAllSongs();
  const artists = useMemo(() => groupByArtist(all.data?.items ?? []), [all.data]);

  useEffect(() => {
    if (params.songId) {
      setView({ kind: "song", id: params.songId });
      setEditing(null);
    }
  }, [params.songId]);

  const showSongs = tab !== "artists" || !!search;
  const query: SongQuery = {
    ...defaultSongQuery(),
    text: search || null,
    favoritesOnly: tab === "favorites",
    archivedOnly: tab === "archived",
    sort: search ? "relevance" : "title",
    limit: 1000,
  };
  const list = useQuery({ queryKey: ["songs", query], queryFn: () => api.songs.list(query), placeholderData: (prev) => prev, enabled: showSongs });
  const matchingArtists = search ? artists.filter((a) => a.key && a.name.toLowerCase().includes(search.toLowerCase())) : [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["songs"] });
    void qc.invalidateQueries({ queryKey: ["song-facets"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const go = async (next: View) => {
    if (editing && !(await confirmLeaveEditor())) return;
    setEditing(null);
    setView(next);
  };
  const newSong = (artist?: string) => {
    setView({ kind: "none" });
    setEditing({ ...emptySong(), artist: artist && artist !== NO_ARTIST ? artist : null });
  };
  const openArtist = view.kind === "artist" ? artists.find((a) => a.key === view.key) : undefined;
  // Previous / next song follow the list the song was opened from.
  const order =
    view.kind === "song"
      ? (view.fromArtist !== undefined ? artists.find((a) => a.key === view.fromArtist)?.songs : showSongs ? list.data?.items : all.data?.items)?.map((s) => s.id) ?? []
      : [];
  const position = view.kind === "song" ? order.indexOf(view.id) : -1;
  const stepTo = (delta: number, autoPlay: boolean) => view.kind === "song" && setView({ ...view, id: order[position + delta]!, autoPlay });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border">
        <div className="space-y-2.5 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Song Library</h1>
            <div className="flex gap-1">
              <IconButton label="Import songs" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)} />
              <IconButton label="Export all songs" icon={<FileDown className="size-4" />} onClick={() => void exportSongs(null)} />
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => newSong()}>
                New song
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search songs, artists or lyrics" className="pl-8" aria-label="Search songs" />
            {text && (
              <button type="button" aria-label="Clear search" onClick={() => setText("")} className="absolute top-2.5 right-2.5 text-subtle hover:text-text">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex gap-0.5 rounded-md bg-bg p-0.5" role="tablist" aria-label="Show">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn("flex-1 rounded px-2 py-1 text-xs", tab === t.id ? "bg-elevated font-semibold text-text shadow-sm" : "text-muted hover:text-text")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!showSongs ? (
            all.isLoading ? (
              <LoadingBlock />
            ) : artists.length === 0 ? (
              <EmptyState icon={<Music />} title="No songs yet" description="Add a song by typing or pasting its lyrics, or import a song list." />
            ) : (
              artists.map((a) => (
                <ArtistRow key={a.key || "none"} artist={a} cover={covers.coverUrl(a.key)} contain={covers.isDefault(covers.coverUrl(a.key))} active={view.kind === "artist" && view.key === a.key} onClick={() => void go({ kind: "artist", key: a.key })} />
              ))
            )
          ) : (
            <>
              {matchingArtists.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Artists</p>
                  {matchingArtists.map((a) => (
                    <ArtistRow key={a.key} artist={a} cover={covers.coverUrl(a.key)} contain={covers.isDefault(covers.coverUrl(a.key))} active={false} onClick={() => void go({ kind: "artist", key: a.key })} />
                  ))}
                  <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Songs</p>
                </>
              )}
              {list.isLoading && <LoadingBlock />}
              {list.isError && <ErrorNotice title="Songs could not be loaded" message={String(list.error)} />}
              {list.data?.items.length === 0 && (
                <EmptyState
                  icon={<Music />}
                  title={search ? "No songs match your search" : tab === "favorites" ? "No favorite songs yet" : tab === "archived" ? "No archived songs" : "No songs yet"}
                  description={search ? "Try fewer words." : tab === "favorites" ? "Press the star on a song to add it here." : undefined}
                />
              )}
              {list.data?.items.map((s) => (
                <SongRow
                  key={s.id}
                  song={s}
                  cover={covers.coverUrl(artistKey(s.artist))}
                  contain={covers.isDefault(covers.coverUrl(artistKey(s.artist)))}
                  active={view.kind === "song" && view.id === s.id && !editing}
                  onClick={() => void go({ kind: "song", id: s.id })}
                />
              ))}
            </>
          )}
        </div>
        {!showSongs && artists.length > 0 && <p className="border-t border-border px-3 py-1.5 text-xs text-subtle">{`${artists.length} artist${artists.length === 1 ? "" : "s"} · ${all.data?.total ?? 0} songs`}</p>}
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <SongEditor
            initial={editing}
            artists={artists.filter((a) => a.key).map((a) => a.name)}
            onSaved={(song) => {
              invalidate();
              setEditing(null);
              setView({ kind: "song", id: song.id });
            }}
            onCancel={() => setEditing(null)}
          />
        ) : view.kind === "song" ? (
          <SongDetail
            key={view.id}
            id={view.id}
            autoPlay={view.autoPlay ?? false}
            onPrevious={position > 0 ? () => stepTo(-1, false) : undefined}
            onNext={position >= 0 && position < order.length - 1 ? (autoPlay) => stepTo(1, autoPlay) : undefined}
            backTo={view.fromArtist !== undefined ? (artists.find((a) => a.key === view.fromArtist)?.name ?? null) : null}
            onBack={() => view.fromArtist !== undefined && setView({ kind: "artist", key: view.fromArtist })}
            onArtist={(name) => setView({ kind: "artist", key: artistKey(name) })}
            onEdit={(doc) => setEditing(doc)}
            onDeleted={() => {
              setView(view.fromArtist !== undefined ? { kind: "artist", key: view.fromArtist } : { kind: "none" });
              invalidate();
            }}
            onChanged={invalidate}
            onSelect={(id) => setView({ kind: "song", id })}
          />
        ) : openArtist ? (
          <ArtistPage
            artist={openArtist}
            cover={covers.coverUrl(openArtist.key)}
            contain={covers.isDefault(covers.coverUrl(openArtist.key))}
            hasCover={covers.hasCover(openArtist.key)}
            onCover={(mediaId) => covers.setCover(openArtist.key, mediaId)}
            onSong={(id) => setView({ kind: "song", id, fromArtist: openArtist.key })}
            onNewSong={() => newSong(openArtist.name)}
            onBack={() => setView({ kind: "none" })}
          />
        ) : tab === "artists" && artists.length > 0 ? (
          <ArtistGrid artists={artists} covers={covers} onOpen={(key) => setView({ kind: "artist", key })} />
        ) : (
          <EmptyState icon={<Music />} title="Select a song" description="Choose a song to see its slides, present it, or add it to a service." className="h-full" />
        )}
      </div>
      <SongImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={invalidate} />
    </div>
  );
}

async function confirmLeaveEditor() {
  return confirm({ title: "Discard changes?", message: "The song you are editing has not been saved.", confirmLabel: "Discard", danger: true });
}

function ArtistRow({ artist, cover, contain, active, onClick }: { artist: Artist; cover: string | null; contain: boolean; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left", active ? "bg-primary/15" : "hover:bg-elevated")}>
      <ArtistCover name={artist.name} url={cover} contain={contain} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", artist.key ? "text-text" : "text-muted italic")}>{artist.name}</span>
        <span className="block text-xs text-subtle">
          {artist.songs.length} song{artist.songs.length === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

function SongRow({ song, cover, contain, active, onClick }: { song: SongSummary; cover: string | null; contain: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={() => void presentSong(song)}
      className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left", active ? "bg-primary/15" : "hover:bg-elevated")}
    >
      <ArtistCover name={song.artist?.trim() || NO_ARTIST} url={cover} contain={contain} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm text-text">
          <span className="truncate">{song.title}</span>
          {song.isFavorite && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label="Favorite" />}
        </span>
        <span className="block truncate text-xs text-subtle">{[song.artist, song.firstLine].filter(Boolean).join(" · ") || "No lyrics yet"}</span>
      </span>
    </button>
  );
}

function ArtistGrid({ artists, covers, onOpen }: { artists: Artist[]; covers: ReturnType<typeof useArtistCovers>; onOpen: (key: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-accent">Artists</h2>
          <span aria-hidden className="mt-1 block h-0.5 w-10 rounded-full bg-primary" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-subtle">{covers.defaultChosen ? "Default cover: your picture" : "Default cover: gold album"}</span>
          <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking(true)} title="Shown for artists and songs without a cover picture">
            Default cover…
          </Button>
          {covers.defaultChosen && (
            <Button size="sm" variant="ghost" onClick={() => covers.setDefaultCover(null)}>
              Use the gold album
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        {artists.map((a) => (
          <button key={a.key || "none"} type="button" onClick={() => onOpen(a.key)} className="group rounded-lg p-2 text-left hover:bg-elevated" aria-label={`Artist ${a.name}`}>
            <ArtistCover
              name={a.name}
              url={covers.coverUrl(a.key)}
              contain={covers.isDefault(covers.coverUrl(a.key))}
              size="lg"
              className="transition-transform group-hover:scale-[1.02]"
            />
            <p className={cn("mt-2 truncate text-sm font-medium", !a.key && "text-muted italic")}>{a.name}</p>
            <p className="text-xs text-subtle">
              {a.songs.length} song{a.songs.length === 1 ? "" : "s"}
            </p>
          </button>
        ))}
      </div>
      <MediaPickerDialog
        open={picking}
        kind="image"
        title="Default cover for songs and artists without one"
        onClose={() => setPicking(false)}
        onPick={(m) => {
          covers.setDefaultCover(m.id);
          setPicking(false);
        }}
      />
    </div>
  );
}

function ArtistPage({
  artist,
  cover,
  contain,
  hasCover,
  onCover,
  onSong,
  onNewSong,
  onBack,
}: {
  artist: Artist;
  cover: string | null;
  contain: boolean;
  hasCover: boolean;
  onCover: (mediaId: string | null) => void;
  onSong: (id: string) => void;
  onNewSong: () => void;
  onBack: () => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-end gap-5 border-b border-border px-6 py-5">
        <ArtistCover name={artist.name} url={cover} contain={contain} size="xl" />
        <div className="min-w-0 flex-1 pb-1">
          <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-text">
            <ArrowLeft className="size-3.5" /> All artists
          </button>
          <p className="text-xs font-semibold tracking-wide text-subtle uppercase">Artist</p>
          <h2 className="truncate text-2xl font-bold">{artist.name}</h2>
          <p className="text-sm text-muted">
            {artist.songs.length} song{artist.songs.length === 1 ? "" : "s"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {artist.key && (
              <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking(true)}>
                {hasCover ? "Change cover…" : "Add cover picture…"}
              </Button>
            )}
            {hasCover && (
              <Button size="sm" variant="ghost" onClick={() => onCover(null)}>
                Remove cover
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onNewSong}>
              New song{artist.key ? ` by ${artist.name}` : ""}
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-2 px-2 text-xs font-semibold tracking-wide text-subtle uppercase">Songs</p>
        <ol className="space-y-0.5">
          {artist.songs.map((s, i) => (
            <li key={s.id}>
              <div className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-elevated">
                <span className="w-6 text-right text-sm text-subtle">{i + 1}</span>
                <button type="button" onClick={() => onSong(s.id)} onDoubleClick={() => void presentSong(s)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                    <span className="truncate">{s.title}</span>
                    {s.isFavorite && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label="Favorite" />}
                  </span>
                  <span className="block truncate text-xs text-subtle">{s.firstLine ?? "No lyrics yet"}</span>
                </button>
                <IconButton size="sm" label={`Present ${s.title}`} icon={<MonitorPlay className="size-4" />} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => void presentSong(s)} />
              </div>
            </li>
          ))}
        </ol>
      </div>
      <MediaPickerDialog
        open={picking}
        kind="image"
        title={`Cover picture for ${artist.name}`}
        onClose={() => setPicking(false)}
        onPick={(m) => {
          onCover(m.id);
          setPicking(false);
        }}
      />
    </div>
  );
}

function SongDetail({
  id,
  autoPlay,
  onPrevious,
  onNext,
  backTo,
  onBack,
  onArtist,
  onEdit,
  onDeleted,
  onChanged,
  onSelect,
}: {
  id: string;
  autoPlay: boolean;
  onPrevious?: () => void;
  onNext?: (autoPlay: boolean) => void;
  backTo: string | null;
  onBack: () => void;
  onArtist: (name: string) => void;
  onEdit: (doc: SongDocument) => void;
  onDeleted: () => void;
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const song = useQuery({ queryKey: ["song", id], queryFn: () => api.songs.get(id) });
  const settings = useSettings();
  const covers = useArtistCovers();
  const { theme, media } = useRenderTheme(song.data?.themeId, "song");
  const slides = useMemo(
    () => (song.data ? songToSlides(song.data, "preview", { maxLinesPerSlide: setting(settings.data, "presentation.maxLinesPerSlide", 4) }) : []),
    [song.data, settings.data],
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["song", id] });
    onChanged();
  };
  const favorite = useMutation({ mutationFn: (v: boolean) => api.songs.setFavorite(id, v), onSuccess: refresh, onError: (e) => toast.error("Could not update favorite", e) });
  const archive = useMutation({
    mutationFn: (v: boolean) => api.songs.setArchived(id, v),
    onSuccess: (_d, v) => {
      refresh();
      toast.success(v ? "Song archived" : "Song restored from archive");
    },
    onError: (e) => toast.error("Could not archive the song", e),
  });

  if (song.isLoading) return <LoadingBlock />;
  if (song.isError || !song.data) return <div className="p-6"><ErrorNotice title="The song could not be loaded" message={String(song.error ?? "")} /></div>;
  const s = song.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-5 py-4">
        {backTo !== null && (
          <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-text">
            <ArrowLeft className="size-3.5" /> {backTo}
          </button>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ArtistCover name={s.artist?.trim() || NO_ARTIST} url={covers.coverUrl(artistKey(s.artist))} contain={covers.isDefault(covers.coverUrl(artistKey(s.artist)))} />
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-lg font-semibold">
                <span className="truncate">{s.title}</span>
                {s.archivedAt && <Badge tone="warning">Archived</Badge>}
              </h2>
              {s.artist ? (
                <button type="button" onClick={() => onArtist(s.artist!)} className="truncate text-sm text-muted hover:text-text hover:underline">
                  {s.artist}
                </button>
              ) : (
                <p className="text-sm text-subtle">No artist</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="live" icon={<MonitorPlay className="size-4" />} onClick={() => void presentSong(s)} disabled={slides.length === 0}>
              Present now
            </Button>
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => addToService([{ id: null, itemType: "song", title: s.title, refId: s.id, settings: {}, notes: null }], `“${s.title}”`)}>
              Add to service
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(songToDocument(s))}>
              Edit
            </Button>
            <IconButton label={s.isFavorite ? "Remove from favorites" : "Add to favorites"} icon={<Star className={cn("size-4", s.isFavorite && "fill-warning text-warning")} />} onClick={() => favorite.mutate(!s.isFavorite)} />
            <IconButton
              label="Duplicate"
              icon={<Copy className="size-4" />}
              onClick={async () => {
                try {
                  const copy = await api.songs.duplicate(s.id);
                  onChanged();
                  onSelect(copy.id);
                  toast.success("Song duplicated");
                } catch (e) {
                  toast.error("Could not duplicate the song", e);
                }
              }}
            />
            <IconButton label={s.archivedAt ? "Restore from archive" : "Archive"} icon={s.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => archive.mutate(!s.archivedAt)} />
            <IconButton label="Export this song" icon={<FileDown className="size-4" />} onClick={() => void exportSongs([s.id])} />
            <IconButton
              label="Delete"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete “${s.title}”?`,
                  message: "The song will be removed from the library. Services that use it will show it as missing. Consider archiving instead.",
                  confirmLabel: "Delete song",
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api.songs.remove(s.id);
                  toast.success("Song deleted");
                  onDeleted();
                } catch (e) {
                  toast.error("Could not delete the song", e);
                }
              }}
            />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <MusicPanel song={s} autoPlay={autoPlay} onPrevious={onPrevious} onNext={onNext} />
        {slides.length === 0 ? (
          <EmptyState title="This song has no lyrics yet" action={<Button onClick={() => onEdit(songToDocument(s))}>Add lyrics</Button>} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
            {slides.map((sl, i) => (
              <SlideThumb key={sl.id} slide={sl} theme={theme} media={media} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
