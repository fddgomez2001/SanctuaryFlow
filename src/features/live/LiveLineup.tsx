import { useEffect, useRef, useState } from "react";
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CircleAlert, FileUp, Film, Folder, ListPlus, Lock, Paintbrush, Palette, Search, Trash2, WifiOff } from "lucide-react";
import type { MediaAsset } from "@/types/generated/MediaAsset";
import { api } from "@/services/api";
import { mediaRef } from "@/services/presentation-engine/media";
import { pickFile } from "@/lib/files";
import type { Theme } from "@/types/generated/Theme";
import { IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { Input } from "@/components/ui/Field";
import { DragHandle } from "@/components/ui/SortableList";
import { toast } from "@/components/ui/Toast";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { useThemes } from "@/hooks/useThemes";
import { themeIdOf } from "@/lib/service-items";
import { DEFAULT_THEME } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { useStoredState } from "@/hooks/useStoredState";
import type { PresentationItem } from "@/services/presentation-engine/engine";
import { isBibleNow, useLive } from "@/services/presentation-engine/store";
import { useBibleNow } from "./bibleNow";
import { addToService } from "@/features/services/AddToServiceDialog";
import { ItemIcon } from "@/features/services/ItemIcon";
import { useThemeEditor } from "./QuickThemeEditor";
import { setItemBackground } from "./itemLook";
import { useOnline } from "@/hooks/useOnline";

type DragData = { kind: "theme"; themeId: string } | { kind: "customize" } | { kind: "background"; media: MediaAsset } | { kind: "item" };

/** Dragged onto an item, not reordered among the items. */
const isDropCard = (d: DragData | undefined) => d?.kind === "theme" || d?.kind === "customize" || d?.kind === "background";

/** Puts a video or picture behind an item's words and says so. */
async function applyBackground(item: PresentationItem, media: MediaAsset) {
  try {
    await setItemBackground(item, media);
    toast.success(`“${media.title}” is now the background of “${item.title}”`);
  } catch (e) {
    toast.error("The background could not be applied", e);
  }
}

const dragData = (e: { active: { data: { current?: unknown } } }) => e.active.data.current as DragData | undefined;

// Themes are dropped on the item under the pointer; items reorder by nearest slot.
const collision: CollisionDetection = (args) => (isDropCard(args.active.data.current as DragData | undefined) ? pointerWithin(args) : closestCenter(args));

/** Applies a theme to one lineup item and says so. */
async function applyTheme(item: PresentationItem, theme: Theme) {
  try {
    await useLive.getState().setItemTheme(item.id, theme.id);
    toast.success(`“${item.title}” now uses the “${theme.name}” theme`);
  } catch (e) {
    toast.error("The theme could not be applied", e);
  }
}

/**
 * The service lineup on the Live page: items are rearranged by dragging the
 * handle (or with the keyboard), and a theme from the palette below can be
 * dropped on any item to give it its own look.
 */
export function LiveLineup({ onImport }: { onImport: () => void }) {
  const live = useLive();
  const themes = useThemes();
  const { engine } = live;
  const [dragging, setDragging] = useState<Theme | MediaAsset | "customize" | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const passageDrag = useBibleNow((s) => s.drag);
  // Verses shown from the Bible view are not part of the lineup.
  const listed = engine.items.map((item, index) => ({ item, index })).filter(({ item }) => !isBibleNow(item.id));
  const ids = listed.map(({ item }) => item.id);
  const unlisted = engine.items.filter((i) => isBibleNow(i.id)).map((i) => i.id);
  const selectedIndex = engine.selectedItemIndex ?? engine.live?.itemIndex ?? null;

  const onDragStart = (e: DragStartEvent) => {
    const data = dragData(e);
    if (data?.kind === "theme") setDragging(themes.data?.find((t) => t.id === data.themeId) ?? null);
    if (data?.kind === "customize") setDragging("customize");
    if (data?.kind === "background") setDragging(data.media);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const data = dragData(e);
    if (!e.over) return;
    if (data?.kind === "customize") {
      const target = engine.items.find((i) => i.id === e.over!.id);
      if (target && target.type !== "heading") useThemeEditor.getState().open(target.id);
      return;
    }
    if (data?.kind === "background") {
      const target = engine.items.find((i) => i.id === e.over!.id);
      if (target && target.type !== "heading") void applyBackground(target, data.media);
      return;
    }
    if (data?.kind === "theme") {
      const target = engine.items.find((i) => i.id === e.over!.id);
      const theme = themes.data?.find((t) => t.id === data.themeId);
      if (target && theme && target.type !== "heading") void applyTheme(target, theme);
      return;
    }
    if (e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) void live.reorderItems([...arrayMove(ids, from, to), ...unlisted]);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{live.serviceTitle ?? "Quick presentation"}</p>
          <p className="text-xs text-subtle">
            {listed.length} item{listed.length === 1 ? "" : "s"}
          </p>
        </div>
        <IconButton size="sm" label="Add PowerPoint, PDF or Canva design" icon={<FileUp className="size-4" />} onClick={onImport} />
      </div>
      <div
        className={cn("relative min-h-0 flex-1 overflow-y-auto p-1.5 transition-colors", passageDrag && "bg-primary/5", passageDrag?.overLineup && "bg-primary/10 ring-2 ring-primary ring-inset")}
        aria-label="Service lineup"
        role="group"
        data-lineup-drop
      >
        {passageDrag && (
          <p className="sticky top-0 z-10 mb-1 rounded-md bg-primary px-2 py-1 text-center text-xs font-semibold text-white shadow">
            {passageDrag.overLineup ? `Drop to add “${passageDrag.title}”` : `Drag here to add “${passageDrag.title}” to the service`}
          </p>
        )}
        {listed.length === 0 && !live.loading && <EmptyState title="Nothing to present" description="Choose a service above, or present a song or passage below." />}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {listed.map(({ item, index }) => (
            <LineupRow key={item.id} item={item} index={index} selected={selectedIndex === index} themes={themes.data ?? []} />
          ))}
        </SortableContext>
      </div>
      <ThemePalette themes={themes.data ?? []} selected={selectedIndex != null ? (engine.items[selectedIndex] ?? null) : null} />
      <DragOverlay dropAnimation={null}>
        {dragging === "customize" ? (
          <CustomizeCardBody overlay />
        ) : dragging && "kind" in dragging ? (
          <MediaCardBody media={dragging} overlay />
        ) : (
          dragging && <ThemeCard theme={dragging} overlay />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function LineupRow({ item, index, selected, themes }: { item: PresentationItem; index: number; selected: boolean; themes: Theme[] }) {
  const live = useLive();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } = useSortable({ id: item.id, data: { kind: "item" } satisfies DragData });
  const handle = { attributes: attributes as unknown as Record<string, unknown>, listeners };
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative" as const };
  const dropping = isOver ? (active?.data.current as DragData | undefined) : undefined;
  const themeOver = isDropCard(dropping) && item.type !== "heading";

  if (item.type === "heading") {
    return (
      <div ref={setNodeRef} style={style} className={cn("group flex items-center gap-1 pt-2", isDragging && "opacity-80")}>
        <DragHandle handle={handle} label={`Move ${item.title}`} />
        <p className="flex-1 truncate pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{item.title}</p>
      </div>
    );
  }

  const source = [...live.serviceItems, ...live.adhocItems].find((s) => s.id === item.id);
  const ownThemeId = source ? themeIdOf(source.settings ?? {}) : null;
  const ownTheme = ownThemeId ? themes.find((t) => t.id === ownThemeId) : undefined;
  const adhoc = live.adhocItems.some((a) => a.id === item.id);
  const isLive = live.projector.open && live.engine.live?.itemIndex === index;
  const online = useOnline();

  const note = source?.notes?.trim();
  return (
    <div ref={setNodeRef} style={style} className="py-px" data-lineup-item={item.id}>
      <div
        role="button"
        tabIndex={0}
        aria-label={item.title}
        onClick={() => live.dispatch({ type: "select", itemIndex: index })}
        onDoubleClick={() => item.slides.length && live.dispatch({ type: "goLive", itemIndex: index, slideIndex: 0 })}
        onKeyDown={(e) => e.key === "Enter" && live.dispatch({ type: "select", itemIndex: index })}
        className={cn(
          "group flex items-center gap-1 rounded-md border-l-2 py-1 pr-2 pl-0.5",
          isLive ? "border-live bg-live/10" : selected ? "border-primary bg-primary/10" : "border-transparent hover:bg-primary/5",
          isDragging && "bg-elevated shadow-lg",
          themeOver && "ring-2 ring-primary ring-inset",
        )}
      >
        <DragHandle handle={handle} label={`Move ${item.title}`} />
        <ItemIcon kind={item.kind ?? item.type} />
        <div className="ml-1 min-w-0 flex-1">
          <p className="truncate text-sm">{item.title}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-subtle">
            {themeOver ? (
              <span className="font-medium text-primary">
                {dropping?.kind === "customize"
                  ? "Drop to customize its look"
                  : dropping?.kind === "background"
                    ? `Drop to use this ${dropping.media.kind === "video" ? "video" : "picture"} as background`
                    : "Drop to use this theme"}
              </span>
            ) : (
              <>
                {note && (
                  <span className="max-w-32 shrink-0 truncate font-medium text-accent" title={note}>
                    {note} ·
                  </span>
                )}
                {adhoc ? "Added live · " : ""}
                {item.slides.length} slide{item.slides.length === 1 ? "" : "s"}
                {ownTheme && (
                  <span className="inline-flex min-w-0 items-center gap-0.5" title={`Theme: ${ownTheme.name}`}>
                    · <Palette className="size-3 shrink-0" />
                    <span className="truncate">{ownTheme.name}</span>
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {live.locked === item.id && <Lock className="size-3.5 shrink-0 text-primary" aria-label="The output is locked on this item" />}
        {item.error && <CircleAlert className="size-3.5 shrink-0 text-warning" aria-label={item.error} />}
        {item.kind === "canva" && item.slides.length <= 1 && item.slides[0]?.content.kind === "web" && (
          <CircleAlert className="size-3.5 shrink-0 text-warning" aria-label="Set how many pages this Canva design has" />
        )}
        {item.kind === "canva" && !online && (
          <WifiOff className="size-3.5 shrink-0 text-warning" aria-label="No internet connection: this Canva design can't be shown" />
        )}
        {adhoc && (
          <div className="hidden gap-0.5 group-hover:flex">
            {live.serviceId && (
              <IconButton
                size="sm"
                label="Add to the service"
                icon={<ListPlus className="size-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  const src = live.adhocItems.find((a) => a.id === item.id);
                  if (src) addToService([{ ...src, id: null }], `“${src.title}”`);
                }}
              />
            )}
            <IconButton
              size="sm"
              label="Remove"
              icon={<Trash2 className="size-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                void live.removeAdhoc(item.id);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE = { kind: "lyrics" as const, lines: ["Sing to the Lord", "a new song"], sectionLabel: "", songTitle: "", footer: null };

function ThemeCard({ theme, overlay }: { theme: Theme; overlay?: boolean }) {
  const settings = useLive((s) => s.themes.get(theme.id)) ?? DEFAULT_THEME;
  const media = useLive((s) => s.media);
  return (
    <div className={cn("w-full overflow-hidden rounded-md border border-border bg-bg text-left", overlay && "w-36 rotate-2 shadow-2xl ring-2 ring-primary")}>
      <div className="relative w-full" style={{ aspectRatio: 16 / 9 }}>
        <SlideRenderer content={SAMPLE} slideKey={`theme:${theme.id}`} theme={settings} output="normal" media={media} logo={null} aspect={16 / 9} className="absolute inset-0 overflow-hidden" />
      </div>
      <p className="truncate px-1.5 py-0.5 text-[11px] text-muted">{theme.name}</p>
    </div>
  );
}

function ThemeChip({ theme, selected }: { theme: Theme; selected: PresentationItem | null }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `theme:${theme.id}`, data: { kind: "theme", themeId: theme.id } satisfies DragData });
  return (
    <button
      ref={setNodeRef}
      type="button"
      // Pointer dragging only: Enter and Space keep working as a click.
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={() => {
        if (!selected || selected.type === "heading") toast.info("Select an item first, or drag the theme onto it.");
        else void applyTheme(selected, theme);
      }}
      aria-label={`Theme ${theme.name}`}
      title={`Drag onto an item, or click to use it for the selected item`}
      className={cn("cursor-grab touch-none rounded-md hover:ring-2 hover:ring-primary/60 active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <ThemeCard theme={theme} />
    </button>
  );
}

function CustomizeCardBody({ overlay }: { overlay?: boolean }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-md border-2 border-dashed border-primary/60 bg-primary/5 text-left",
        overlay && "w-36 rotate-2 bg-panel shadow-2xl",
      )}
    >
      <div className="flex w-full flex-col items-center justify-center gap-1 text-primary" style={{ aspectRatio: 16 / 9 }}>
        <Paintbrush className="size-5" />
        <span className="text-[11px] font-semibold">Customize</span>
      </div>
      <p className="truncate px-1.5 py-0.5 text-[11px] text-muted">Font, size, width…</p>
    </div>
  );
}

/** Opens the look editor for the item it is dropped on (or the selected item when clicked). */
function CustomizeCard({ selected }: { selected: PresentationItem | null }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: "customize", data: { kind: "customize" } satisfies DragData });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={() => {
        if (!selected || selected.type === "heading") toast.info("Select an item first, or drag Customize onto it.");
        else useThemeEditor.getState().open(selected.id);
      }}
      aria-label="Customize the look of an item"
      title="Drag onto a song or item to change its font, size, width, alignment and fade"
      className={cn("cursor-grab touch-none rounded-md active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <CustomizeCardBody />
    </button>
  );
}

function MediaCardBody({ media, overlay }: { media: MediaAsset; overlay?: boolean }) {
  const ref = mediaRef(media);
  return (
    <div className={cn("w-full overflow-hidden rounded-md border border-border bg-bg text-left", overlay && "w-36 rotate-2 shadow-2xl ring-2 ring-primary")}>
      <div className="relative flex w-full items-center justify-center bg-black" style={{ aspectRatio: 16 / 9 }}>
        {ref?.posterUrl ? <img src={ref.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : <Film className="size-5 text-subtle" />}
        {media.kind === "video" && <Film className="absolute right-1 bottom-1 size-3.5 text-white drop-shadow" />}
      </div>
      <p className="truncate px-1.5 py-0.5 text-[11px] text-muted">{media.title}</p>
    </div>
  );
}

function MediaChip({ media, picked, onPick }: { media: MediaAsset; picked: boolean; onPick: () => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `media:${media.id}`, data: { kind: "background", media } satisfies DragData });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={onPick}
      aria-pressed={picked}
      aria-label={`${media.kind === "video" ? "Video" : "Picture"} ${media.title}`}
      title="Drag onto a song or item to put it behind the words, or click it and then choose “Use for …”"
      className={cn(
        "cursor-grab touch-none rounded-md active:cursor-grabbing",
        picked ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/60",
        isDragging && "opacity-40",
      )}
    >
      <MediaCardBody media={media} />
    </button>
  );
}

/** A folder of the Media Library, as a small chip in the palette. */
function FolderChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active ? "border-primary bg-primary text-white" : "border-border bg-bg text-muted hover:border-primary/50 hover:text-text",
      )}
    >
      <Folder className="size-3" />
      {label}
    </button>
  );
}

type PaletteTab = "themes" | "video" | "image";

const PALETTE_IDLE_MS = 2 * 60_000;

function ThemePalette({ themes, selected }: { themes: Theme[]; selected: PresentationItem | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useStoredState("live.themePaletteOpen", true);
  const [tab, setTab] = useStoredState<PaletteTab>("live.paletteTab", "themes");
  // Left unused for two minutes, the palette folds away to give the lineup room.
  const lastUse = useRef(Date.now());
  const touch = () => (lastUse.current = Date.now());
  useEffect(() => {
    if (!open) return;
    lastUse.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastUse.current >= PALETTE_IDLE_MS) setOpen(false);
    }, 5_000);
    return () => clearInterval(timer);
  }, [open, setOpen]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const [folder, setFolder] = useState<string | null>(null);
  const [picked, setPicked] = useState<MediaAsset | null>(null);
  const media = useQuery({
    queryKey: ["media", tab],
    queryFn: () => api.media.list({ kind: tab === "video" ? "video" : "image", text: null }),
    enabled: open && tab !== "themes",
  });
  const shownThemes = q ? themes.filter((t) => t.name.toLowerCase().includes(q)) : themes;
  const kindMedia = (media.data ?? []).filter((m) => !m.missing);
  // Folders that hold this kind of media, as in the Media Library.
  const folders = [...new Set(kindMedia.map((m) => m.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const shownMedia = kindMedia.filter((m) => (!folder || m.folder === folder) && (!q || m.title.toLowerCase().includes(q)));
  const usePicked = () => {
    if (!picked) return;
    if (!selected || selected.type === "heading") {
      toast.info("Select an item first, or drag the picture onto one.");
      return;
    }
    void applyBackground(selected, picked);
    setPicked(null);
  };
  const importMedia = async () => {
    const path = await pickFile({
      title: tab === "video" ? "Import a background video" : "Import a background picture",
      filters: [{ name: tab === "video" ? "Videos" : "Pictures", extensions: tab === "video" ? ["mp4", "m4v", "mov", "webm", "mkv"] : ["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"] }],
    });
    if (!path) return;
    try {
      const [outcome] = await api.media.importFiles([path]);
      if (!outcome?.result) throw new Error(outcome?.error ?? "The file could not be imported.");
      void qc.invalidateQueries({ queryKey: ["media"] });
      toast.success(`“${outcome.result.asset.title}” was added`);
    } catch (e) {
      toast.error("The file could not be imported", e);
    }
  };
  const tabs: { id: PaletteTab; label: string }[] = [
    { id: "themes", label: "Themes" },
    { id: "video", label: "Videos" },
    { id: "image", label: "Pictures" },
  ];
  return (
    <div className="shrink-0 border-t border-border" onPointerDown={touch} onPointerMove={touch} onKeyDown={touch} onWheel={touch}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-muted hover:text-text">
        <Palette className="size-3.5" />
        <span className="flex-1">Themes and backgrounds</span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto px-2 pb-2">
          <div className="mb-1.5 flex gap-0.5 rounded-md bg-bg p-0.5" role="tablist" aria-label="Palette">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setQuery("");
                  setFolder(null);
                  setPicked(null);
                }}
                className={cn("flex-1 rounded px-2 py-1 text-xs", tab === t.id ? "bg-elevated font-semibold text-text shadow-sm" : "text-muted hover:text-text")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mb-1.5 text-[11px] text-subtle">
            {tab === "themes"
              ? "Drag a theme onto a song or item, or click it to use it for the selected item."
              : `Drag a ${tab === "video" ? "video" : "picture"} onto a song or item to put it behind the words, or click it and choose “Use for …”.`}
          </p>
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "themes" ? "Search themes" : tab === "video" ? "Search videos" : "Search pictures"}
              aria-label={tab === "themes" ? "Search themes" : tab === "video" ? "Search videos" : "Search pictures"}
              className="h-7 pl-7 text-xs"
            />
          </div>
          {tab === "themes" ? (
            <div className="grid grid-cols-2 gap-1.5">
              <CustomizeCard selected={selected} />
              {shownThemes.map((t) => (
                <ThemeChip key={t.id} theme={t} selected={selected} />
              ))}
            </div>
          ) : (
            <>
            {folders.length > 0 && (
              <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]" role="group" aria-label="Folders">
                <FolderChip label="All" active={folder === null} onClick={() => setFolder(null)} />
                {folders.map((f) => (
                  <FolderChip key={f} label={f} active={folder === f} onClick={() => setFolder(folder === f ? null : f)} />
                ))}
              </div>
            )}
            {picked && (
              <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-1.5 rounded-md border border-primary/50 bg-panel p-1.5 shadow-sm" role="status">
                <span className="min-w-0 flex-1 truncate text-[11px]">
                  <strong>{picked.title}</strong>
                  {selected && selected.type !== "heading" ? ` → ${selected.title}` : " · select an item"}
                </span>
                <button type="button" onClick={usePicked} disabled={!selected || selected.type === "heading"} className="shrink-0 rounded bg-primary px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50">
                  Use for item
                </button>
                <button type="button" aria-label="Cancel" onClick={() => setPicked(null)} className="shrink-0 rounded px-1 text-subtle hover:text-text">
                  ×
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {shownMedia.map((m) => (
                <MediaChip key={m.id} media={m} picked={picked?.id === m.id} onPick={() => setPicked(picked?.id === m.id ? null : m)} />
              ))}
              <button
                type="button"
                onClick={() => void importMedia()}
                className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-xs text-muted hover:border-primary hover:text-text"
                style={{ aspectRatio: 16 / 10 }}
              >
                <FileUp className="size-4" />
                Import {tab === "video" ? "video" : "picture"}…
              </button>
            </div>
            </>
          )}
          {q && (tab === "themes" ? shownThemes.length === 0 : shownMedia.length === 0) && <p className="mt-1.5 text-[11px] text-subtle">Nothing matches “{query.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}
