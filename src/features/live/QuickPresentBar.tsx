import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { BookOpen, Music, Presentation, Zap } from "lucide-react";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { setting, useSettings } from "@/hooks/useSettings";
import { parseReferences } from "@/lib/bible/reference";
import { canonBook, referenceBooks } from "@/lib/bible/canon";
import { presentDeck, presentSong } from "@/services/presentation-engine/quick";
import { defaultSongQuery } from "@/features/songs/query";
import { cn } from "@/lib/cn";
import { highlightParts, matchingLine, simplify } from "@/lib/lyrics-search";
import { useBibleNow } from "./bibleNow";

const FALLBACK_EXAMPLES = ["John 3:16", "How Great Is Our God", "Midweek Service", "Psalm 23", "Bible Study"];

/** Types one example after another into the empty box, as a hint of what can be presented. */
function useTypingHint(examples: string[], active: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active || !examples.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(examples[0]!);
      return;
    }
    let example = 0;
    let shown = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const word = examples[example % examples.length]!;
      if (!deleting) {
        shown++;
        setText(word.slice(0, shown));
        if (shown >= word.length) {
          deleting = true;
          timer = setTimeout(tick, 1700);
          return;
        }
        timer = setTimeout(tick, 75 + Math.random() * 40);
      } else {
        shown--;
        setText(word.slice(0, shown));
        if (shown <= 0) {
          deleting = false;
          example++;
          timer = setTimeout(tick, 350);
          return;
        }
        timer = setTimeout(tick, 32);
      }
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [active, examples]);
  return text;
}

/** After presenting, the arrow keys go back to moving through the slides. */
const handBackKeyboard = () => (document.activeElement as HTMLElement | null)?.blur();

/** Present a song, a slide deck or a Bible passage right away. Passages open the Bible view. */
export function QuickPresentBar() {
  const [text, setText] = useState("");
  const settings = useSettings();
  const translationId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  const bible = useBibleNow();
  const q = text.trim();
  const refs = useMemo(() => (q ? parseReferences(q, referenceBooks()) : []), [q]);
  const isRef = refs.length > 0 && refs.every((r) => r.ok);
  const songs = useQuery({
    queryKey: ["songs", "quick", q],
    queryFn: () => api.songs.list({ ...defaultSongQuery(), text: q, sort: "relevance", limit: 5 }),
    enabled: q.length >= 2 && !isRef,
  });
  const decks = useQuery({ queryKey: ["decks", null], queryFn: () => api.decks.list(null) });
  const matchingDecks = q.length >= 2 && !isRef ? (decks.data ?? []).filter((d) => d.title.toLowerCase().includes(q.toLowerCase())).slice(0, 4) : [];
  const songChoices = songs.data?.items ?? [];
  // Songs found by their words show the line they were found by.
  const songDetails = useQueries({
    queries: songChoices.map((s) => ({ queryKey: ["song", s.id], queryFn: () => api.songs.get(s.id), staleTime: 60_000 })),
  });
  const foundLine = (index: number): string | null => {
    const song = songDetails[index]?.data;
    if (!song || simplify(song.title).includes(simplify(q))) return null;
    return matchingLine(song.sections.flatMap((sec) => sec.lyrics.split("\n")), q);
  };

  // Examples from this library: a few song titles and slide decks between Bible references.
  const examplesSongs = useQuery({ queryKey: ["songs", "quick-examples"], queryFn: () => api.songs.list({ ...defaultSongQuery(), sort: "recent", limit: 4 }) });
  const examples = useMemo(() => {
    const songTitles = (examplesSongs.data?.items ?? []).map((s) => s.title);
    const deckTitles = (decks.data ?? []).map((d) => d.title).slice(0, 3);
    if (!songTitles.length && !deckTitles.length) return FALLBACK_EXAMPLES;
    const refsPool = ["John 3:16", "Psalm 23", "Romans 8:28"];
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      out.push(refsPool[i]!);
      if (songTitles[i]) out.push(songTitles[i]!);
      if (deckTitles[i]) out.push(deckTitles[i]!);
    }
    return out;
  }, [examplesSongs.data, decks.data]);
  const [focused, setFocused] = useState(false);
  const hint = useTypingHint(examples, !text);

  const openPassage = () => {
    const id = translationId ?? translations.data?.[0]?.id ?? null;
    if (!id) {
      toast.warning("Add a Bible translation first", "Install one in the Bible Library.");
      return;
    }
    const first = refs.find((r) => r.ok);
    if (!first?.ok) return;
    const r = first.ref;
    const start = r.verseStart ?? 1;
    const end = r.chapterEnd == null || r.chapterEnd === r.chapter ? (r.verseEnd ?? start) : start;
    void bible.show({ translationId: id, bookId: r.bookId, chapter: r.chapter }, Array.from({ length: end - start + 1 }, (_, i) => start + i));
    setText("");
    handBackKeyboard();
  };

  const go = () => {
    if (isRef) openPassage();
    else if (songChoices[0]) {
      void presentSong(songChoices[0]);
      setText("");
      handBackKeyboard();
    } else if (matchingDecks[0]) {
      void presentDeck(matchingDecks[0]);
      setText("");
      handBackKeyboard();
    }
  };

  const showChoices = q.length >= 2 && !isRef && (songChoices.length > 0 || matchingDecks.length > 0);
  return (
    <div className="relative border-t border-border bg-panel p-2.5" data-shortcuts="off">
      {showChoices && (
        <div className="absolute right-2.5 bottom-full left-2.5 mb-1 rounded-lg border border-border bg-panel p-1 shadow-xl">
          {songChoices.map((s, i) => {
            const line = foundLine(i);
            return (
              <button
                key={s.id}
                type="button"
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
                onClick={() => {
                  void presentSong(s);
                  setText("");
                  handBackKeyboard();
                }}
              >
                <Music className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.title}</span>
                    <span className="ml-auto shrink-0 truncate text-xs text-subtle">{s.artist}</span>
                  </span>
                  {line && (
                    <span className="mt-0.5 block truncate text-xs text-muted italic">
                      “
                      {highlightParts(line, q).map((part, k) =>
                        part.match ? (
                          <mark key={k} className="rounded bg-primary/25 px-0.5 text-text not-italic">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={k}>{part.text}</span>
                        ),
                      )}
                      ”
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {matchingDecks.map((d) => (
            <button
              key={d.id}
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
              onClick={() => {
                void presentDeck(d);
                setText("");
              }}
            >
              <Presentation className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{d.title}</span>
              <span className="ml-auto text-xs text-subtle">Slides</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Zap className="pointer-events-none absolute top-2.5 left-3 size-4 text-primary" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Present a song or Scripture now"
            aria-describedby="present-now-hint"
            className="pl-9"
          />
          {!text && (
            <span id="present-now-hint" className="pointer-events-none absolute inset-y-0 left-9 flex items-center overflow-hidden text-sm whitespace-nowrap text-subtle">
              <span className="text-muted">Present now:&nbsp;</span>
              <span>{hint}</span>
              <span aria-hidden className={cn("ml-px inline-block h-4 w-px animate-pulse", focused ? "bg-primary" : "bg-subtle")} />
            </span>
          )}
        </div>
        {bible.chapter && !bible.open && (
          <Button variant="secondary" icon={<BookOpen className="size-4" />} onClick={() => bible.setOpen(true)} title="Back to the open chapter">
            {canonBook(bible.chapter.bookId)?.name ?? bible.chapter.bookId} {bible.chapter.chapter}
          </Button>
        )}
        <Button variant="primary" onClick={go} disabled={!isRef && !songChoices.length && !matchingDecks.length}>
          Present
        </Button>
      </div>
      {isRef && <p className="mt-1 text-xs text-success">{refs.map((r) => (r.ok ? r.display : "")).join("; ")} · press Enter to open the chapter and show it</p>}
      {q && !isRef && /\d/.test(q) && <ReferenceHint results={refs} />}
    </div>
  );
}

/** Explains why typed text with numbers is not a valid reference. */
function ReferenceHint({ results }: { results: ReturnType<typeof parseReferences> }) {
  const bad = results.find((r) => !r.ok);
  return bad && !bad.ok ? <p className="mt-1 text-xs text-subtle">{bad.error}</p> : null;
}
