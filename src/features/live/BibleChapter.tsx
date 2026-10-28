import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, ListChecks, ListPlus, X } from "lucide-react";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, TextField } from "@/components/ui/Field";
import { EmptyState, LoadingBlock } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { newId } from "@/lib/slides/deck";
import { setting, useSettings } from "@/hooks/useSettings";
import { canonBook } from "@/lib/bible/canon";
import { cleanText } from "@/lib/slides/scripture";
import { currentItem } from "@/services/presentation-engine/engine";
import { isBibleNow, useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";
import { bibleNowThemeId, passageTitle, useBibleNow, versesToRefs } from "./bibleNow";

/** Pixels the pointer moves before a press on a verse becomes a drag. */
const DRAG_START = 6;

/**
 * A whole chapter in the middle of the Live page. Clicking a verse shows it
 * on the output; Ctrl+click adds or removes a verse, Shift+click takes a
 * range, and "Select several" makes plain clicks add verses too. Verses can
 * be dragged onto the lineup (or added with "Add to lineup") as a service item.
 */
export function BibleChapter() {
  const { chapter, selected, anchor, several, show, select, setOpen, setSeveral, setVerseCount, drag, setDrag, startAdding, itemId } = useBibleNow();
  const locked = useLive((s) => s.locked);
  // "2/3": which slide of the passage is showing (a string, so the store is not re-read in a loop).
  const slidePosition = useLive((s) => {
    const item = currentItem(s.engine);
    return item && isBibleNow(item.id) && item.id === itemId && s.engine.live ? `${s.engine.live.slideIndex + 1}/${item.slides.length}` : null;
  });
  const [slideAt, slideOf] = (slidePosition ?? "0/0").split("/").map(Number);
  const slides = slidePosition ? { at: slideAt!, of: slideOf! } : null;
  const press = useRef<{ x: number; y: number; verses: number[] } | null>(null);
  const dragged = useRef(false);
  const settings = useSettings();
  const hideMarks = setting(settings.data, "bible.hideParagraphMarks", true);
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  const verses = useQuery({
    queryKey: ["bible-chapter", chapter?.translationId, chapter?.bookId, chapter?.chapter],
    queryFn: () => api.bible.chapter(chapter!.translationId, chapter!.bookId, chapter!.chapter),
    enabled: !!chapter,
  });
  // The chosen verses are on screen only if they are the passage being shown (not just prepared under a lock).
  const onScreen = useLive((s) => {
    const item = currentItem(s.engine);
    return !!item && item.id === itemId && s.projector.open && s.engine.output === "normal";
  });
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (verses.data) setVerseCount(verses.data.length);
  }, [verses.data, setVerseCount]);

  // Dragging verses: a ghost follows the pointer; letting go over the lineup adds them.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const start = press.current;
      if (!start || !chapter) return;
      const current = useBibleNow.getState().drag;
      if (!current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START) return;
      const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-lineup-drop]");
      const title = current?.title ?? passageTitle(chapter.bookId, versesToRefs(chapter.bookId, chapter.chapter, start.verses));
      setDrag({ title, x: e.clientX, y: e.clientY, overLineup: over });
    };
    const up = (e: PointerEvent) => {
      const start = press.current;
      press.current = null;
      const current = useBibleNow.getState().drag;
      if (!start || !current) return;
      dragged.current = true;
      setDrag(null);
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target?.closest("[data-lineup-drop]")) startAdding(start.verses, target.closest<HTMLElement>("[data-lineup-item]")?.dataset.lineupItem ?? null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [chapter, setDrag, startAdding]);
  // Keep the verse being shown in view.
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, verses.data]);

  if (!chapter) return null;
  const book = canonBook(chapter.bookId);
  const name = book?.name ?? chapter.bookId;
  const lastChapter = book?.chapters ?? chapter.chapter;
  const goChapter = (n: number) => void show({ ...chapter, chapter: n }, []);

  const pick = (verse: number, e: React.MouseEvent) => {
    // The press that started a drag is not also a click.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (e.shiftKey && anchor != null) {
      const [a, b] = anchor < verse ? [anchor, verse] : [verse, anchor];
      void select(Array.from({ length: b - a + 1 }, (_, i) => a + i), anchor);
    } else if (e.ctrlKey || e.metaKey || several) {
      const next = selected.includes(verse) ? selected.filter((v) => v !== verse) : [...selected, verse];
      void select(next, verse);
    } else {
      void select([verse], verse);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <BookOpen className="size-4" />
        </span>
        <h2 className="ml-1 shrink-0 text-base font-semibold whitespace-nowrap">
          {name} {chapter.chapter}
        </h2>
        <IconButton size="sm" label="Previous chapter" icon={<ChevronLeft className="size-4" />} disabled={chapter.chapter <= 1} onClick={() => goChapter(chapter.chapter - 1)} />
        <IconButton size="sm" label="Next chapter" icon={<ChevronRight className="size-4" />} disabled={chapter.chapter >= lastChapter} onClick={() => goChapter(chapter.chapter + 1)} />
        <Select
          aria-label="Translation"
          className="ml-1 h-8 w-[4.75rem] shrink-0 text-xs"
          value={chapter.translationId}
          onChange={(e) => void show({ ...chapter, translationId: e.target.value }, selected)}
        >
          {translations.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant={several ? "primary" : "secondary"}
          className="shrink-0"
          icon={<ListChecks className="size-3.5" />}
          aria-pressed={several}
          title="Select several verses: clicks add verses instead of replacing them"
          onClick={() => setSeveral(!several)}
        >
          Several
        </Button>
        <Button
          size="sm"
          className="shrink-0"
          icon={<ListPlus className="size-3.5" />}
          disabled={!selected.length}
          title="Add the chosen verses to the service as an item (or drag them onto the lineup)"
          onClick={() => startAdding(selected)}
        >
          Add to lineup
        </Button>
        <IconButton size="sm" className="shrink-0" label="Close the Bible" icon={<X className="size-4" />} onClick={() => setOpen(false)} />
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border bg-bg/60 px-4 py-1.5 text-xs text-muted">
        {selected.length ? (
          <>
            <span className={cn("size-2 rounded-full", onScreen ? "bg-live" : "bg-primary")} />
            <span>
              {onScreen ? "On screen: " : locked ? "Prepared (the output is locked): " : "Ready: "}
              <strong className="text-text">{passageTitle(chapter.bookId, versesToRefs(chapter.bookId, chapter.chapter, selected))}</strong>
              {slides && slides.of > 1 && (
                <span className="ml-1.5 text-subtle">
                  · slide {slides.at} of {slides.of}
                </span>
              )}
            </span>
            {selected.length > 1 && (
              <button type="button" className="ml-auto shrink-0 text-primary hover:underline" onClick={() => void select(selected.slice(0, 1), selected[0])}>
                Show one verse
              </button>
            )}
          </>
        ) : (
          <span>Click a verse to show it. Ctrl+click adds more, Shift+click takes a range, and → / ← move verse by verse.</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {verses.isLoading && <LoadingBlock />}
        {verses.isError && <EmptyState title="This chapter is not in the translation" description="Choose another translation or chapter." />}
        <ol ref={list} className="mx-auto max-w-3xl space-y-1 px-4 py-4" aria-label={`${name} ${chapter.chapter}`}>
          {verses.data?.map((v) => {
            const isSelected = selected.includes(v.verse);
            const live = isSelected && onScreen;
            return (
              <li key={`${v.verse}-${v.verseEnd ?? ""}`}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${name} ${chapter.chapter}:${v.verse}`}
                  title="Click to show · drag onto the lineup to add it to the service"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    dragged.current = false;
                    press.current = { x: e.clientX, y: e.clientY, verses: selected.includes(v.verse) ? selected : [v.verse] };
                  }}
                  onClick={(e) => pick(v.verse, e)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border-l-4 px-3 py-2 text-left transition-colors",
                    live ? "border-live bg-live/10" : isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-elevated",
                  )}
                >
                  <span className="w-7 shrink-0 pt-0.5 text-right text-sm font-semibold text-primary tabular-nums">{v.verse}</span>
                  <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-text">{cleanText(v.text, hideMarks)}</span>
                  {live && <span className="mt-1 shrink-0 rounded bg-live px-1.5 text-[10px] font-bold text-white">LIVE</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {drag &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-[60] flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-2xl",
              drag.overLineup ? "bg-primary" : "bg-secondary/90",
            )}
            style={{ left: drag.x + 14, top: drag.y + 10 }}
          >
            <BookOpen className="size-4" /> {drag.title}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Adds the verses chosen in the Bible view to the service (or the lineup), with an optional note. */
export function AddPassageDialog() {
  const { adding, stopAdding } = useBibleNow();
  const live = useLive();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (adding) {
      setTitle(adding.title);
      setNote("");
    }
  }, [adding]);
  const add = async () => {
    if (!adding) return;
    setBusy(true);
    try {
      const id = newId();
      await live.addItem({
        id,
        itemType: "scripture",
        title: title.trim() || adding.title,
        refId: null,
        settings: { translationId: adding.translationId, references: adding.references, themeId: bibleNowThemeId(live.settings) },
        notes: note.trim() || null,
      });
      // Dropped onto the lineup: it goes after the item it was dropped on.
      if (adding.afterId) {
        const ids = useLive.getState().engine.items.map((i) => i.id).filter((x) => x !== id);
        const at = ids.indexOf(adding.afterId);
        if (at >= 0) await live.reorderItems([...ids.slice(0, at + 1), id, ...ids.slice(at + 1)]);
      }
      toast.success(`“${title.trim() || adding.title}” was added to ${live.serviceTitle ? `“${live.serviceTitle}”` : "the lineup"}`);
      stopAdding();
    } catch (e) {
      toast.error("The passage could not be added", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!adding}
      onOpenChange={(o) => !o && stopAdding()}
      title={live.serviceTitle ? `Add to “${live.serviceTitle}”` : "Add to the lineup"}
      description="The passage becomes an item in the service, ready to present when its turn comes."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={stopAdding}>
            Cancel
          </Button>
          <Button variant="primary" icon={<ListPlus className="size-4" />} loading={busy} onClick={() => void add()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField label="Passage" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="For example: Tithes and offering"
          hint="Shown with the item in the lineup, only on this screen."
          autoFocus
        />
      </div>
    </Dialog>
  );
}
