import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarPlus, ChevronLeft, ChevronRight, ClipboardCopy, Library, MonitorPlay, Search, Star, X } from "lucide-react";
import type { BibleBookInfo } from "@/types/generated/BibleBookInfo";
import type { PassageRef } from "@/types/generated/PassageRef";
import type { Testament } from "@/types/generated/Testament";
import { api } from "@/services/api";
import { useNav } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, LoadingBlock } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { SlideThumb } from "@/components/slide/SlideThumb";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useRenderTheme } from "@/hooks/useThemes";
import { formatReference, parseReference } from "@/lib/bible/reference";
import { referenceBooks } from "@/lib/bible/canon";
import { passageToSlides, type ScriptureSplit } from "@/lib/slides/scripture";
import { timeAgo } from "@/lib/format";
import { presentScripture } from "@/services/presentation-engine/quick";
import { addToService } from "@/features/services/AddToServiceDialog";
import { cn } from "@/lib/cn";
import { TranslationsTab } from "./TranslationsTab";

type Tab = "read" | "translations";

export function BibleLibraryPage() {
  const params = useNav((s) => s.params);
  const [tab, setTab] = useState<Tab>(params.tab === "translations" ? "translations" : "read");
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  useEffect(() => {
    if (params.tab === "translations") setTab("translations");
    if (params.reference) setTab("read");
  }, [params.tab, params.reference]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
        <h1 className="mr-4 text-base font-semibold">Bible Library</h1>
        {(["read", "translations"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-elevated" : "text-muted hover:text-text")}
          >
            {t === "read" ? <BookOpen className="size-4" /> : <Library className="size-4" />}
            {t === "read" ? "Read & present" : "Translations"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "translations" ? (
          <TranslationsTab />
        ) : translations.isLoading ? (
          <LoadingBlock />
        ) : translations.data?.length ? (
          <ReadTab initialReference={params.reference} />
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title="No Bible translation is installed"
            description="Install a translation from eBible.org or import a licensed file (USFM, USX, OSIS, JSON or CSV). Installed translations work without the internet."
            action={<Button variant="primary" onClick={() => setTab("translations")}>Install a translation</Button>}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}

interface Selection {
  start: number;
  end: number;
}

function ReadTab({ initialReference }: { initialReference?: string | undefined }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  const defaultId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const [translationId, setTranslationId] = useState<string>("");
  const tid = translationId || (translations.data?.some((t) => t.id === defaultId) ? defaultId! : (translations.data?.[0]?.id ?? ""));
  const translation = translations.data?.find((t) => t.id === tid);
  const books = useQuery({ queryKey: ["bible-books", tid], queryFn: () => api.bible.books(tid), enabled: !!tid });
  const [testament, setTestament] = useState<Testament>("NT");
  const [bookId, setBookId] = useState("JHN");
  const [chapter, setChapter] = useState(1);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [refText, setRefText] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [sideTab, setSideTab] = useState<"search" | "recent" | "favorites">("recent");
  const { theme, media } = useRenderTheme(null, "scripture");

  // Make sure the first translation becomes the default.
  useEffect(() => {
    if (!defaultId && translations.data?.[0]) updateSettings.mutate({ "bible.defaultTranslationId": translations.data[0].id });
  }, [defaultId, translations.data, updateSettings]);

  const book = books.data?.find((b) => b.id === bookId);
  const chapterData = useQuery({
    queryKey: ["bible-chapter", tid, bookId, chapter],
    queryFn: () => api.bible.chapter(tid, bookId, chapter),
    enabled: !!tid && !!book?.available,
  });

  const goTo = (ref: PassageRef) => {
    setBookId(ref.bookId);
    setChapter(ref.chapter);
    const b = books.data?.find((x) => x.id === ref.bookId);
    if (b) setTestament(b.testament === "NT" ? "NT" : "OT");
    if (ref.verseStart != null && (ref.chapterEnd == null || ref.chapterEnd === ref.chapter)) {
      setSelection({ start: ref.verseStart, end: ref.verseEnd ?? ref.verseStart });
      setAnchor(ref.verseStart);
      setScrollTarget(`${ref.bookId}:${ref.chapter}:${ref.verseStart}`);
    } else setSelection(null);
  };

  const jump = (text: string) => {
    const r = parseReference(text, referenceBooks(books.data));
    if (!r.ok) {
      setRefError(r.error);
      return;
    }
    setRefError(null);
    goTo(r.ref);
  };

  useEffect(() => {
    if (initialReference && books.data) {
      setRefText(initialReference);
      jump(initialReference);
    }
  }, [initialReference, books.data]);

  const selectedRef: PassageRef | null = selection
    ? { bookId, chapter, verseStart: selection.start, chapterEnd: null, verseEnd: selection.end !== selection.start ? selection.end : null }
    : book
      ? { bookId, chapter, verseStart: null, chapterEnd: null, verseEnd: null }
      : null;
  const refLabel = selectedRef && book ? formatReference(book.name, selectedRef) : "";
  const selectedVerses = (chapterData.data ?? []).filter((v) => !selection || ((v.verseEnd ?? v.verse) >= selection.start && v.verse <= selection.end));
  const slides = useMemo(
    () =>
      book && selectedVerses.length && selection
        ? passageToSlides({ bookName: book.name, translationCode: translation?.code ?? null, verses: selectedVerses }, "preview", {
            split: setting<ScriptureSplit>(settings.data, "presentation.scriptureSplit", "fit"),
            maxChars: setting(settings.data, "presentation.maxScriptureCharsPerSlide", 320),
            hideParagraphMarks: setting(settings.data, "bible.hideParagraphMarks", true),
          })
        : [],
    [book, selectedVerses, selection, translation, settings.data],
  );

  const saveInput = selectedRef ? { reference: refLabel, translationId: tid, passage: selectedRef } : null;
  const favorites = useQuery({ queryKey: ["bible-favorites"], queryFn: () => api.bible.savedPassages(true, 100) });
  const recent = useQuery({ queryKey: ["bible-recent"], queryFn: () => api.bible.savedPassages(false, 30) });
  const isFavorite = !!favorites.data?.some((f) => f.reference === refLabel);
  const toggleFavorite = useMutation({
    mutationFn: () => api.bible.setFavorite(saveInput!, !isFavorite),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bible-favorites"] }),
    onError: (e) => toast.error("Could not update favorites", e),
  });

  const search = useQuery({
    queryKey: ["bible-search", tid, searchText],
    queryFn: () => api.bible.search({ translationId: tid, text: searchText, testament: null, bookId: null, limit: 200, offset: 0 }),
    enabled: !!tid && searchText.trim().length >= 2,
  });

  // Bring the selected verses into view after a jump or search.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTarget || !chapterData.data) return;
    document.querySelector(`[data-verse="${scrollTarget}"]`)?.scrollIntoView({ block: "center" });
    setScrollTarget(null);
  }, [scrollTarget, chapterData.data]);

  const clickVerse = (n: number, shift: boolean) => {
    if (shift && anchor != null) setSelection({ start: Math.min(anchor, n), end: Math.max(anchor, n) });
    else {
      setSelection({ start: n, end: n });
      setAnchor(n);
    }
  };

  const changeChapter = (dir: -1 | 1) => {
    if (!books.data || !book) return;
    const next = chapter + dir;
    if (next >= 1 && next <= book.chapterCount) {
      setChapter(next);
      setSelection(null);
      return;
    }
    const idx = books.data.findIndex((b) => b.id === bookId);
    const nb = books.data.slice(dir > 0 ? idx + 1 : 0, dir > 0 ? undefined : idx).filter((b) => b.available);
    const target = dir > 0 ? nb[0] : nb[nb.length - 1];
    if (target) {
      setBookId(target.id);
      setChapter(dir > 0 ? 1 : target.chapterCount);
      setTestament(target.testament === "NT" ? "NT" : "OT");
      setSelection(null);
    }
  };

  const visibleBooks = (books.data ?? []).filter((b) => (testament === "NT" ? b.testament === "NT" : b.testament !== "NT"));

  return (
    <div className="flex h-full min-h-0">
      {/* Books & chapters */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-2">
          <Select
            aria-label="Translation"
            value={tid}
            onChange={(e) => {
              setTranslationId(e.target.value);
              setSelection(null);
            }}
          >
            {translations.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.name}
              </option>
            ))}
          </Select>
          {translation && translation.validationStatus !== "complete" && (
            <Badge tone="warning">{translation.validationStatus === "incomplete" ? "Incomplete translation" : "Not validated"}</Badge>
          )}
          <div className="grid grid-cols-2 gap-1">
            {(["OT", "NT"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTestament(t)} className={cn("rounded-md py-1 text-xs", testament === t ? "bg-elevated text-text" : "text-muted hover:text-text")}>
                {t === "OT" ? "Old Testament" : "New Testament"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {visibleBooks.map((b: BibleBookInfo) => (
            <button
              key={b.id}
              type="button"
              disabled={!b.available}
              onClick={() => {
                setBookId(b.id);
                setChapter(1);
                setSelection(null);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm disabled:opacity-35",
                b.id === bookId ? "bg-primary/15 text-text" : "text-muted hover:enabled:bg-elevated hover:enabled:text-text",
              )}
            >
              <span className="truncate">{b.name}</span>
              <span className="text-[11px] text-subtle">{b.available ? b.chapterCount : "—"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chapter text */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2" data-shortcuts="off">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              jump(refText);
            }}
          >
            <Input value={refText} onChange={(e) => setRefText(e.target.value)} placeholder="Go to… e.g. Psalm 23 or John 3:16-18" className="w-72" aria-label="Go to reference" />
            <Button type="submit">Go</Button>
          </form>
          {refError && <span className="text-xs text-danger">{refError}</span>}
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Previous chapter" icon={<ChevronLeft className="size-4" />} onClick={() => changeChapter(-1)} />
            <span className="min-w-28 text-center text-sm font-medium">
              {book?.name} {chapter}
            </span>
            <IconButton label="Next chapter" icon={<ChevronRight className="size-4" />} onClick={() => changeChapter(1)} />
          </div>
        </div>
        {book && book.chapterCount > 1 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-border px-4 py-2">
            {Array.from({ length: book.chapterCount }, (_, i) => i + 1).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setChapter(c);
                  setSelection(null);
                }}
                className={cn("min-w-8 rounded px-1.5 py-0.5 text-xs", c === chapter ? "bg-primary text-white" : "bg-bg text-muted hover:text-text")}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {chapterData.isLoading && <LoadingBlock />}
          {chapterData.isError && <EmptyState title="This chapter is not available" description={String((chapterData.error as Error)?.message ?? "")} />}
          {chapterData.data?.length === 0 && <EmptyState title="This chapter has no text in this translation." />}
          <div className="max-w-3xl space-y-0.5 text-[15px] leading-relaxed selectable" dir={translation?.textDirection === "rtl" ? "rtl" : "ltr"}>
            {chapterData.data?.map((v) => {
              const selected = selection && (v.verseEnd ?? v.verse) >= selection.start && v.verse <= selection.end;
              return (
                <p
                  key={v.verse}
                  data-verse={`${v.bookId}:${v.chapter}:${v.verse}`}
                  onClick={(e) => clickVerse(v.verse, e.shiftKey)}
                  className={cn("cursor-pointer rounded px-2 py-1", selected ? "bg-primary/20" : "hover:bg-elevated")}
                >
                  <sup className="mr-1 text-xs font-semibold text-subtle">{v.verseEnd ? `${v.verse}–${v.verseEnd}` : v.verse}</sup>
                  {v.text}
                </p>
              );
            })}
          </div>
          {chapterData.data && chapterData.data.length > 0 && <p className="mt-3 text-xs text-subtle">Click a verse to select it; Shift+click another verse to select a range.</p>}
        </div>
        {selectedRef && book?.available && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-2">
            <span className="mr-2 text-sm font-semibold">{refLabel}</span>
            <Badge>{translation?.code}</Badge>
            <div className="ml-auto flex gap-1.5">
              <Button variant="live" icon={<MonitorPlay className="size-4" />} onClick={() => void presentScripture(tid, [selectedRef], refLabel)}>
                Present
              </Button>
              <Button
                icon={<CalendarPlus className="size-4" />}
                onClick={() => addToService([{ id: null, itemType: "scripture", title: refLabel, refId: null, settings: { translationId: tid, references: [selectedRef] }, notes: null }], refLabel)}
              >
                Add to service
              </Button>
              <IconButton
                label="Copy reference and text"
                icon={<ClipboardCopy className="size-4" />}
                onClick={async () => {
                  const text = `${refLabel} (${translation?.code})\n${selectedVerses.map((v) => `${v.verse} ${v.text}`).join(" ")}`;
                  await navigator.clipboard.writeText(text);
                  toast.success("Copied to the clipboard");
                }}
              />
              <IconButton label={isFavorite ? "Remove favorite" : "Add to favorites"} icon={<Star className={cn("size-4", isFavorite && "fill-warning text-warning")} />} onClick={() => toggleFavorite.mutate()} />
              {selection && <IconButton label="Clear selection" icon={<X className="size-4" />} onClick={() => setSelection(null)} />}
            </div>
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="flex w-80 shrink-0 flex-col border-l border-border">
        <div className="flex gap-1 border-b border-border p-2">
          {(["search", "recent", "favorites"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setSideTab(t)} className={cn("flex-1 rounded-md py-1 text-xs capitalize", sideTab === t ? "bg-elevated" : "text-muted hover:text-text")}>
              {t}
            </button>
          ))}
        </div>
        {sideTab === "search" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative p-2" data-shortcuts="off">
              <Search className="pointer-events-none absolute top-4.5 left-4.5 size-4 text-subtle" />
              <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={`Search ${translation?.code ?? ""} text`} className="pl-8" autoFocus />
            </div>
            <p className="px-3 text-xs text-subtle">{search.data ? `${search.data.total} verse${search.data.total === 1 ? "" : "s"}${search.data.total > search.data.hits.length ? ` (showing ${search.data.hits.length})` : ""}` : ""}</p>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {search.data?.hits.map((h) => (
                <button
                  key={`${h.bookId}${h.chapter}:${h.verse}`}
                  type="button"
                  onClick={() => goTo({ bookId: h.bookId, chapter: h.chapter, verseStart: h.verse, chapterEnd: null, verseEnd: h.verseEnd })}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-elevated"
                >
                  <p className="text-xs font-semibold">
                    {h.bookName} {h.chapter}:{h.verse}
                  </p>
                  <p className="line-clamp-3 text-xs text-muted">{highlight(h.highlighted)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {sideTab !== "search" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {(sideTab === "recent" ? recent.data : favorites.data)?.length === 0 && (
              <p className="p-3 text-xs text-subtle">{sideTab === "recent" ? "Passages you present appear here." : "Star a passage to keep it here."}</p>
            )}
            {(sideTab === "recent" ? recent.data : favorites.data)?.map((p) => (
              <div key={p.id} className="group flex items-center rounded hover:bg-elevated">
                <button type="button" onClick={() => goTo(p.passage)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                  <p className="truncate text-sm">{p.reference}</p>
                  {p.lastUsedAt && <p className="text-[11px] text-subtle">used {timeAgo(p.lastUsedAt)}</p>}
                </button>
                <IconButton
                  size="sm"
                  label="Present"
                  icon={<MonitorPlay className="size-3.5" />}
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => void presentScripture(p.translationId ?? tid, [p.passage], p.reference)}
                />
              </div>
            ))}
          </div>
        )}
        {slides.length > 0 && (
          <div className="max-h-[45%] overflow-y-auto border-t border-border p-2">
            <p className="mb-1.5 text-xs font-semibold text-subtle">SLIDE PREVIEW ({slides.length})</p>
            <div className="space-y-2">
              {slides.map((s, i) => (
                <SlideThumb key={s.id} slide={s} theme={theme} media={media} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders FTS highlight markers (U+E000 … U+E001) as <mark>. */
function highlight(text: string) {
  const parts = text.split(/([^]*)/);
  return parts.map((p, i) =>
    p.startsWith("") ? (
      <mark key={i} className="rounded bg-warning/30 px-0.5 text-text">
        {p.slice(1, -1)}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
