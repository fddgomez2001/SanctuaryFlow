import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Film,
  FileUp,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MonitorPlay,
  Music2,
  Palette,
  Pencil,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { MediaAsset } from "@/types/generated/MediaAsset";
import type { MediaFolder } from "@/types/generated/MediaFolder";
import type { MediaKind } from "@/types/generated/MediaKind";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { Field, Input, Select, TextField } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import { Badge, EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { formatBytes, formatDuration, timeAgo } from "@/lib/format";
import { DEFAULT_ALBUM_URL } from "@/lib/default-art";
import { pickFolder } from "@/lib/files";
import { mediaRef } from "@/services/presentation-engine/media";
import { presentMedia } from "@/services/presentation-engine/quick";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useMediaRefs, useThemes } from "@/hooks/useThemes";
import { normalizeTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { processMedia } from "./thumbnails";

const KIND_ICON: Record<MediaKind, React.ReactNode> = { image: <ImageIcon />, video: <Film />, audio: <Music2 /> };
const KIND_TABS: [MediaKind | null, string][] = [
  [null, "All"],
  ["image", "Pictures"],
  ["video", "Videos"],
  ["audio", "Audio"],
];
const OUTFIT = '"Outfit Variable", "Inter Variable", sans-serif';
/** Folders made in the Media Library that have nothing in them yet (kept on this computer). */
const EMPTY_FOLDERS_KEY = "media.emptyFolders";

/** Thumbnails and measurements happen after an import, one file at a time. */
function processInBackground(assets: MediaAsset[]) {
  void (async () => {
    for (const a of assets) {
      const problem = await processMedia(a);
      if (problem && a.kind !== "image") toast.warning(`${a.title}: ${problem}`);
    }
  })();
}

export async function importMediaFiles(paths: string[], folder: string | null = null): Promise<MediaAsset[]> {
  if (!paths.length) return [];
  const outcomes = await api.media.importFiles(paths);
  const failed = outcomes.filter((o) => o.error);
  const added = outcomes.filter((o) => o.result && !o.result.duplicate).map((o) => o.result!.asset);
  const dupes = outcomes.filter((o) => o.result?.duplicate).length;
  if (folder && added.length) await api.media.setFolder(added.map((a) => a.id), folder);
  if (added.length) toast.success(`Imported ${added.length} file${added.length === 1 ? "" : "s"}${folder ? ` into “${folder}”` : ""}`, dupes ? `${dupes} already in the library.` : undefined);
  else if (dupes) toast.info(`${dupes} file${dupes === 1 ? " is" : "s are"} already in the library`);
  for (const f of failed) toast.error(`Could not import ${f.path.split(/[\\/]/).pop()}`, f.error);
  processInBackground(added);
  return outcomes.flatMap((o) => (o.result ? [o.result.asset] : []));
}

/** The picture shown for a file: its still, or the gold album picture. */
function posterOf(m: MediaAsset): string {
  return mediaRef(m)?.posterUrl ?? DEFAULT_ALBUM_URL;
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(items: MediaAsset[]): string {
  const n = (k: MediaKind) => items.filter((m) => m.kind === k).length;
  const parts = [counted(n("image"), "picture", "pictures"), counted(n("video"), "video", "videos"), counted(n("audio"), "audio file", "audio files")];
  return items.length ? parts.filter((p) => !p.startsWith("0 ")).join(" · ") : "Nothing here yet";
}

export function MediaLibraryPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const [folder, setFolder] = useState<string | null>(null);
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [naming, setNaming] = useState<null | { mode: "new" } | { mode: "rename"; from: string }>(null);
  const [busy, setBusy] = useState<null | "files" | "folder">(null);
  const exts = useQuery({ queryKey: ["media-extensions"], queryFn: api.media.supportedExtensions, staleTime: Infinity });
  // Everything in the current folder (or the whole library); tabs and search filter it here.
  const scope = useQuery({ queryKey: ["media", "scope", folder ?? ""], queryFn: () => api.media.list({ kind: null, text: null, ...(folder ? { folder } : {}) }), placeholderData: (p) => p });
  const folders = useQuery({ queryKey: ["media", "folders"], queryFn: api.media.folders });
  const emptyFolders = useMemo(() => {
    const raw = setting<unknown>(settings.data, EMPTY_FOLDERS_KEY, []);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  }, [settings.data]);
  const allFolders: MediaFolder[] = useMemo(() => {
    const used = folders.data ?? [];
    const extra = emptyFolders.filter((n) => !used.some((f) => f.name.toLowerCase() === n.toLowerCase())).map((name) => ({ name, count: 0, coverIds: [] }));
    return [...used, ...extra].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [folders.data, emptyFolders]);
  const coverRefs = useMediaRefs(allFolders.flatMap((f) => f.coverIds));

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["media"] });
    void qc.invalidateQueries({ queryKey: ["media-refs"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);
  const importing = useRef(false);

  const runImport = async (paths: string[]) => {
    if (importing.current) return;
    importing.current = true;
    setBusy("files");
    try {
      const assets = await importMediaFiles(paths, folder);
      refresh();
      if (assets[0]) setSelected(assets[0].id);
      // Refresh again once thumbnails are likely ready.
      setTimeout(refresh, 2500);
    } catch (e) {
      toast.error("The import failed", e);
    } finally {
      importing.current = false;
      setBusy(null);
    }
  };

  // Files dropped from Windows Explorer.
  const dropTarget = useRef(runImport);
  dropTarget.current = runImport;
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        void dropTarget.current(e.payload.paths);
      }
    });
    return () => void un.then((u) => u());
  }, []);

  // Fill in thumbnails for anything that does not have one yet.
  useEffect(() => {
    const pending = scope.data?.filter((m) => !m.missing && m.kind !== "audio" && !m.thumbnailPath) ?? [];
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      for (const m of pending.slice(0, 10)) {
        if (cancelled) return;
        await processMedia(m);
      }
      if (!cancelled) refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [scope.data?.length, refresh]);

  const chooseFiles = async () => {
    const paths = await open({
      title: folder ? `Import into “${folder}”` : "Import media",
      multiple: true,
      filters: [{ name: "Images, videos and audio", extensions: exts.data ?? ["jpg", "png", "mp4"] }],
    });
    if (Array.isArray(paths)) void runImport(paths);
    else if (typeof paths === "string") void runImport([paths]);
  };

  const chooseFolder = async () => {
    const path = await pickFolder({ title: "Import a folder of pictures, videos or songs" });
    if (!path) return;
    setBusy("folder");
    try {
      const r = await api.media.importFolder(path, folder);
      const added = r.outcomes.filter((o) => o.result && !o.result.duplicate).map((o) => o.result!.asset);
      const dupes = r.outcomes.filter((o) => o.result?.duplicate).length;
      const failed = r.outcomes.filter((o) => o.error);
      toast.success(`Imported ${counted(added.length, "file", "files")} into “${r.folder}”`, [dupes ? `${dupes} already in the library.` : "", failed.length ? `${failed.length} could not be imported.` : ""].filter(Boolean).join(" ") || undefined);
      processInBackground(added);
      refresh();
      setTimeout(refresh, 2500);
      setFolder(r.folder);
      setKind(null);
    } catch (e) {
      toast.error("The folder could not be imported", e);
    } finally {
      setBusy(null);
    }
  };

  const saveEmptyFolders = (names: string[]) => updateSettings.mutate({ [EMPTY_FOLDERS_KEY]: [...new Set(names)] });

  const nameFolder = async (name: string) => {
    if (!naming) return;
    const clean = name.trim().replace(/\s+/g, " ");
    if (naming.mode === "new") {
      if (!allFolders.some((f) => f.name.toLowerCase() === clean.toLowerCase())) saveEmptyFolders([...emptyFolders, clean]);
      setFolder(allFolders.find((f) => f.name.toLowerCase() === clean.toLowerCase())?.name ?? clean);
    } else {
      try {
        await api.media.renameFolder(naming.from, clean);
        if (emptyFolders.includes(naming.from)) saveEmptyFolders(emptyFolders.map((n) => (n === naming.from ? clean : n)));
        refresh();
        setFolder(clean);
        toast.success(`Folder renamed to “${clean}”`);
      } catch (e) {
        toast.error("The folder could not be renamed", e);
        return;
      }
    }
    setKind(null);
    setNaming(null);
  };

  const removeFolder = async (name: string) => {
    const count = allFolders.find((f) => f.name === name)?.count ?? 0;
    const ok = await confirm({
      title: `Remove the folder “${name}”?`,
      message: count ? `Its ${counted(count, "file stays", "files stay")} in the Media Library, outside any folder.` : "The folder is empty.",
      confirmLabel: "Remove folder",
    });
    if (!ok) return;
    try {
      const ids = (await api.media.list({ kind: null, text: null, folder: name })).map((m) => m.id);
      if (ids.length) await api.media.setFolder(ids, null);
      saveEmptyFolders(emptyFolders.filter((n) => n !== name));
      setFolder(null);
      refresh();
    } catch (e) {
      toast.error("The folder could not be removed", e);
    }
  };

  const everything = scope.data ?? [];
  const query = text.trim().toLowerCase();
  const shown = everything.filter(
    (m) => (!kind || m.kind === kind) && (!query || m.title.toLowerCase().includes(query) || m.tags.some((t) => t.toLowerCase().includes(query))),
  );
  const pictures = useMemo(
    () => everything.filter((m) => m.kind === "image" && !m.missing).slice(0, 8).map((m) => ({ id: m.id, url: mediaRef(m)?.url ?? DEFAULT_ALBUM_URL, title: m.title })),
    [everything],
  );
  const current = everything.find((m) => m.id === selected) ?? null;
  const heroButton = "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-60 [&>svg]:size-4";
  const glass = "bg-white/15 text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/25";

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Hero
            key={folder ?? ""}
            eyebrow={folder ? "Folder" : "SanctuaryFlow"}
            title={folder ?? "Media Library"}
            subtitle={scope.isLoading ? "Loading…" : summary(everything)}
            pictures={pictures}
            onBack={folder ? () => setFolder(null) : undefined}
            actions={
              <>
                <button type="button" className={cn(heroButton, "bg-primary text-white shadow-sm hover:bg-primary-hover")} disabled={!!busy} onClick={() => void chooseFiles()}>
                  <FileUp /> {busy === "files" ? "Importing…" : folder ? "Import into this folder" : "Import files"}
                </button>
                <button type="button" className={cn(heroButton, glass)} disabled={!!busy} onClick={() => void chooseFolder()}>
                  <FolderInput /> {busy === "folder" ? "Importing folder…" : "Import a folder"}
                </button>
                {folder ? (
                  <>
                    <button type="button" className={cn(heroButton, glass)} onClick={() => setNaming({ mode: "rename", from: folder })}>
                      <Pencil /> Rename
                    </button>
                    <button type="button" className={cn(heroButton, glass)} onClick={() => void removeFolder(folder)}>
                      <Trash2 /> Remove folder
                    </button>
                  </>
                ) : (
                  <button type="button" className={cn(heroButton, glass)} onClick={() => setNaming({ mode: "new" })}>
                    <FolderPlus /> New folder
                  </button>
                )}
              </>
            }
          />

          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg/90 px-6 py-2.5 backdrop-blur">
            <div className="flex gap-1 rounded-lg bg-elevated p-0.5" role="tablist" aria-label="Kind of media">
              {KIND_TABS.map(([k, label]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("rounded-md px-3 py-1 text-sm transition-colors", kind === k ? "bg-panel font-medium text-text shadow-sm" : "text-muted hover:text-text")}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-subtle">{counted(shown.length, "item", "items")}</span>
            <div className="relative ml-auto w-72">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title or tag" aria-label="Search media" className="pl-8" />
            </div>
          </div>

          <div className="space-y-6 px-6 py-5">
            {!folder && !query && (
              <section aria-label="Folders">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent">
                  <Folder className="size-4 text-primary" /> Folders
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                  {allFolders.map((f) => (
                    <FolderCard key={f.name} folder={f} covers={f.coverIds.map((id) => coverRefs.data?.[id]?.posterUrl).filter((u): u is string => !!u)} onOpen={() => setFolder(f.name)} />
                  ))}
                  <button
                    type="button"
                    onClick={() => setNaming({ mode: "new" })}
                    className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm text-muted transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-text"
                  >
                    <FolderPlus className="size-6 text-primary" /> New folder
                  </button>
                </div>
              </section>
            )}

            <section aria-label="Media">
              {!folder && !query && (
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent">
                  <ImageIcon className="size-4 text-primary" /> {kind ? KIND_TABS.find(([k]) => k === kind)![1] : "All media"}
                </h2>
              )}
              {scope.isLoading && <LoadingBlock />}
              {scope.isError && <ErrorNotice title="Media could not be loaded" message={String(scope.error)} />}
              {scope.data && shown.length === 0 && (
                <EmptyState
                  icon={<ImageIcon />}
                  title={query || kind ? "Nothing matches" : folder ? "This folder is empty" : "No media yet"}
                  description={
                    folder
                      ? "Import files into this folder, or open a file and choose this folder for it."
                      : "Import pictures for backgrounds and announcements, videos for countdowns or motion backgrounds, and songs. You can also drag files here from Windows Explorer. Your original files are not changed."
                  }
                  action={
                    <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => void chooseFiles()}>
                      Import media
                    </Button>
                  }
                />
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                {shown.map((m) => (
                  <MediaCard key={m.id} asset={m} selected={selected === m.id} onSelect={() => setSelected(m.id)} />
                ))}
              </div>
            </section>
          </div>
        </div>
        {dragging && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
            Drop files to import them{folder ? ` into “${folder}”` : ""}
          </div>
        )}
      </div>
      {current && (
        <MediaDetail
          key={current.id}
          asset={current}
          folders={allFolders.map((f) => f.name)}
          onChanged={refresh}
          onNewFolder={() => setNaming({ mode: "new" })}
          onDeleted={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
      <FolderNameDialog
        open={!!naming}
        title={naming?.mode === "rename" ? `Rename “${naming.from}”` : "New folder"}
        initial={naming?.mode === "rename" ? naming.from : ""}
        confirmLabel={naming?.mode === "rename" ? "Rename" : "Create folder"}
        onClose={() => setNaming(null)}
        onSave={(name) => void nameFolder(name)}
      />
    </div>
  );
}

/**
 * The entrance: the library's pictures fading one into the next with a slow
 * zoom, under its title and main actions. Pauses while the pointer is over it.
 */
function Hero({
  eyebrow,
  title,
  subtitle,
  pictures,
  actions,
  onBack,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  pictures: { id: string; url: string; title: string }[];
  actions: ReactNode;
  onBack?: () => void;
}) {
  const slides = pictures.length ? pictures : [{ id: "gold", url: DEFAULT_ALBUM_URL, title: "" }];
  const [view, setView] = useState({ index: 0, previous: null as number | null });
  const [paused, setPaused] = useState(false);
  const index = view.index % slides.length;
  const show = useCallback((i: number) => setView((v) => ({ index: (i + slides.length) % slides.length, previous: v.index % slides.length })), [slides.length]);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = setInterval(() => show(index + 1), 6000);
    return () => clearInterval(timer);
  }, [paused, slides.length, index, show]);

  // Have the next picture ready before it fades in.
  useEffect(() => {
    if (slides.length > 1) new Image().src = slides[(index + 1) % slides.length]!.url;
  }, [index, slides]);

  const prev = view.previous != null && view.previous !== index ? slides[view.previous % slides.length] : undefined;
  const slide = slides[index]!;
  const calm = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${title}: pictures`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="group relative mx-6 mt-5 h-72 overflow-hidden rounded-2xl bg-[#0d0f13] shadow-[0_14px_34px_-14px_rgb(0_0_0/0.55)]"
    >
      {prev && <img src={prev.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
      <img
        key={slide.id}
        src={slide.url}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ animation: calm ? "sf-fade-in 1200ms ease-out both" : "sf-fade-in 1200ms ease-out both, sf-kenburns 7000ms ease-out both" }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgb(8 9 12 / 0.85) 0%, rgb(8 9 12 / 0.45) 45%, transparent 78%), linear-gradient(0deg, rgb(8 9 12 / 0.65) 0%, transparent 50%)" }}
      />
      <div className="absolute inset-y-0 left-0 flex max-w-3xl flex-col justify-end gap-2 p-8 text-white">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-1 flex w-fit items-center gap-1 text-xs text-white/80 hover:text-white">
            <ArrowLeft className="size-3.5" /> All media
          </button>
        )}
        <p className="text-[11px] font-semibold tracking-[0.25em] text-[#e9c46a] uppercase">{eyebrow}</p>
        <h1 className="text-4xl leading-tight font-semibold drop-shadow-[0_2px_8px_rgb(0_0_0/0.35)]" style={{ fontFamily: OUTFIT }}>
          {title}
        </h1>
        <span aria-hidden className="h-0.5 w-12 rounded-full bg-[#e0b95c]" />
        <p className="text-sm text-white/80">{subtitle}</p>
        <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
      </div>
      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous picture"
            onClick={() => show(index - 1)}
            className="absolute top-1/2 right-16 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white opacity-0 ring-1 ring-white/25 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next picture"
            onClick={() => show(index + 1)}
            className="absolute top-1/2 right-5 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white opacity-0 ring-1 ring-white/25 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="absolute right-6 bottom-5 flex items-center gap-3">
            <span className="max-w-60 truncate text-xs text-white/75">{slide.title}</span>
            <div className="flex items-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Show picture ${i + 1} of ${slides.length}`}
                  aria-current={i === index}
                  onClick={() => show(i)}
                  className={cn("h-1.5 rounded-full transition-all duration-300", i === index ? "w-6 bg-[#e0b95c]" : "w-1.5 bg-white/50 hover:bg-white/80")}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** A folder with up to four of its pictures as its cover. */
function FolderCard({ folder, covers, onOpen }: { folder: MediaFolder; covers: string[]; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Folder ${folder.name}, ${counted(folder.count, "item", "items")}`}
      className="group overflow-hidden rounded-xl border border-border bg-panel text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <div className={cn("grid aspect-[4/3] gap-0.5 overflow-hidden bg-[#0d0f13]", covers.length >= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-1")}>
        {(covers.length >= 4 ? covers.slice(0, 4) : [covers[0] ?? DEFAULT_ALBUM_URL]).map((url, i) => (
          <img key={i} src={url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Folder className="size-4 shrink-0 fill-primary/20 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
        <span className="text-xs text-subtle">{folder.count}</span>
      </div>
    </button>
  );
}

function MediaCard({ asset: m, selected, onSelect }: { asset: MediaAsset; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={() => m.kind !== "audio" && void presentMedia(m)}
      title={m.kind === "audio" ? m.title : `${m.title} (double-click to present)`}
      className={cn(
        "group relative overflow-hidden rounded-xl bg-[#0d0f13] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-bg" : "ring-1 ring-border hover:ring-primary/50",
      )}
    >
      <div className="relative aspect-video">
        <img src={posterOf(m)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(0deg,rgb(0_0_0/0.72)_0%,transparent_55%)]" />
        {m.missing && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-warning">
            <TriangleAlert className="mr-1 size-4" /> File missing
          </span>
        )}
        {m.durationMs != null && <span className="absolute top-2 right-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">{formatDuration(m.durationMs / 1000)}</span>}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2.5 py-2 text-white">
          <span className="shrink-0 text-[#e9c46a] [&>svg]:size-3.5">{KIND_ICON[m.kind]}</span>
          <span className="truncate text-xs font-medium">{m.title}</span>
        </div>
      </div>
    </button>
  );
}

function FolderNameDialog({
  open: isOpen,
  title,
  initial,
  confirmLabel,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: string;
  confirmLabel: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (isOpen) setName(initial);
  }, [isOpen, initial]);
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(name)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <TextField label="Folder name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && onSave(name)} autoFocus placeholder="For example: Youth Camp 2026" />
    </Dialog>
  );
}

function MediaDetail({
  asset,
  folders,
  onChanged,
  onNewFolder,
  onDeleted,
}: {
  asset: MediaAsset;
  folders: string[];
  onChanged: () => void;
  onNewFolder: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(asset.title);
  const [tags, setTags] = useState(asset.tags);
  const [themePick, setThemePick] = useState(false);
  const ref = mediaRef(asset);
  const refs = useQuery({ queryKey: ["media-references", asset.id], queryFn: () => api.media.references(asset.id) });
  const dirty = title !== asset.title || JSON.stringify(tags) !== JSON.stringify(asset.tags);

  const moveTo = async (value: string) => {
    if (value === "__new__") {
      onNewFolder();
      return;
    }
    try {
      await api.media.setFolder([asset.id], value || null);
      onChanged();
      toast.success(value ? `Moved to “${value}”` : "Taken out of its folder");
    } catch (e) {
      toast.error("The file could not be moved", e);
    }
  };

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-border bg-panel">
      <div className="bg-[#0d0f13]">
        {ref && asset.kind === "image" && <img src={ref.url} alt="" className="max-h-64 w-full object-contain" />}
        {ref && asset.kind === "video" && <video src={ref.url} controls className="max-h-64 w-full" preload="metadata" />}
        {ref && asset.kind === "audio" && (
          <div className="space-y-3 p-4">
            <img src={DEFAULT_ALBUM_URL} alt="" className="mx-auto size-40 rounded-lg object-cover shadow-lg" draggable={false} />
            <audio src={ref.url} controls className="w-full" />
          </div>
        )}
        {!ref && <div className="flex aspect-video items-center justify-center text-sm text-warning">The file is missing from the media folder.</div>}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          {asset.kind !== "audio" && (
            <Button size="sm" variant="live" icon={<MonitorPlay className="size-3.5" />} disabled={asset.missing} onClick={() => void presentMedia(asset)}>
              Present
            </Button>
          )}
          {asset.kind !== "audio" && (
            <Button size="sm" icon={<Palette className="size-3.5" />} disabled={asset.missing} onClick={() => setThemePick(true)}>
              Use as theme background
            </Button>
          )}
          <IconButton size="sm" label="Show in folder" icon={<FolderOpen className="size-3.5" />} onClick={() => void revealItemInDir(asset.absolutePath)} />
          <IconButton
            size="sm"
            label="Delete"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              const used = refs.data ?? [];
              const ok = await confirm({
                title: `Delete “${asset.title}”?`,
                message: used.length ? (
                  <>
                    <p>This file is used by:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {used.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                    <p className="mt-2">Those places will show their background colour instead.</p>
                  </>
                ) : (
                  "The managed copy will be deleted. Your original file is not affected."
                ),
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              try {
                await api.media.remove(asset.id);
                toast.success("Media deleted");
                onDeleted();
              } catch (e) {
                toast.error("Could not delete the file", e);
              }
            }}
          />
        </div>
        <Field label="Folder">
          <Select value={asset.folder ?? ""} onChange={(e) => void moveTo(e.target.value)} aria-label="Folder">
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value="__new__">New folder…</option>
          </Select>
        </Field>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} />
        </Field>
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              try {
                await api.media.update(asset.id, { title, tags });
                onChanged();
                toast.success("Saved");
              } catch (e) {
                toast.error("Could not save", e);
              }
            }}
          >
            Save details
          </Button>
        )}
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-subtle">Type</dt>
          <dd>{asset.mimeType}</dd>
          <dt className="text-subtle">Size</dt>
          <dd>{formatBytes(asset.sizeBytes)}</dd>
          {asset.width != null && (
            <>
              <dt className="text-subtle">Dimensions</dt>
              <dd>
                {asset.width} × {asset.height}
              </dd>
            </>
          )}
          {asset.durationMs != null && (
            <>
              <dt className="text-subtle">Duration</dt>
              <dd>{formatDuration(asset.durationMs / 1000)}</dd>
            </>
          )}
          <dt className="text-subtle">Original name</dt>
          <dd className="break-all selectable">{asset.originalFilename}</dd>
          <dt className="text-subtle">Imported</dt>
          <dd>{timeAgo(asset.createdAt)}</dd>
          <dt className="text-subtle">Checksum</dt>
          <dd className="font-mono break-all selectable">{asset.checksumSha256.slice(0, 16)}…</dd>
        </dl>
        {refs.data && refs.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-subtle">USED BY</p>
            <ul className="space-y-0.5 text-xs">
              {refs.data.map((r) => (
                <li key={r}>
                  <Badge>{r}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ThemeBackgroundDialog
        open={themePick}
        asset={asset}
        onClose={() => setThemePick(false)}
        onDone={() => {
          setThemePick(false);
          void qc.invalidateQueries({ queryKey: ["themes"] });
          void refs.refetch();
        }}
      />
    </aside>
  );
}

function ThemeBackgroundDialog({ open: isOpen, asset, onClose, onDone }: { open: boolean; asset: MediaAsset; onClose: () => void; onDone: () => void }) {
  const themes = useThemes();
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()} title="Use as a theme background" size="sm">
      <div className="space-y-1">
        {themes.data?.map((t) => (
          <button
            key={t.id}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-elevated"
            onClick={async () => {
              const s = normalizeTheme(t.settings);
              try {
                await api.themes.save({
                  id: t.id,
                  name: t.name,
                  category: t.category,
                  settings: { ...s, background: { ...s.background, type: asset.kind === "video" ? "video" : "image", mediaId: asset.id } },
                });
                toast.success(`“${t.name}” now uses this background`);
                onDone();
              } catch (e) {
                toast.error("The theme could not be updated", e);
              }
            }}
          >
            {t.name}
            <span className="text-xs text-subtle">{t.category}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
