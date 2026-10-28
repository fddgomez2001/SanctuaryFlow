import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileUp, Film, Image as ImageIcon, Music, Presentation, Search } from "lucide-react";
import type { DeckCategory } from "@/types/generated/DeckCategory";
import type { MediaKind } from "@/types/generated/MediaKind";
import type { PassageRef } from "@/types/generated/PassageRef";
import { api } from "@/services/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { EmptyState, LoadingBlock } from "@/components/ui/misc";
import { setting, useSettings } from "@/hooks/useSettings";
import { parseReferences, type ParseResult } from "@/lib/bible/reference";
import { referenceBooks } from "@/lib/bible/canon";
import { mediaRef } from "@/services/presentation-engine/media";
import { defaultSongQuery } from "@/features/songs/query";
import { cn } from "@/lib/cn";
import { pickFile } from "@/lib/files";
import { toast } from "@/components/ui/Toast";
import { DEFAULT_ALBUM_URL } from "@/lib/default-art";

export function SongPickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (song: { id: string; title: string }) => void }) {
  const [text, setText] = useState("");
  const songs = useQuery({
    queryKey: ["songs", "picker", text],
    queryFn: () => api.songs.list({ ...defaultSongQuery(), text: text.trim() || null, sort: text.trim() ? "relevance" : "title", limit: 100 }),
    enabled: open,
    placeholderData: (p) => p,
  });
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add a song" size="md">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title, artist or lyrics" className="pl-8" />
      </div>
      <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {songs.data?.items.length === 0 && <EmptyState icon={<Music />} title="No songs found" description="Add songs in the Song Library first." />}
        {songs.data?.items.map((s) => (
          <button key={s.id} type="button" onClick={() => onPick(s)} className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-elevated">
            <span className="text-sm">{s.title}</span>
            <span className="truncate text-xs text-subtle">{[s.artist, s.firstLine].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export interface ScripturePick {
  translationId: string;
  references: PassageRef[];
  title: string;
}

export function ScripturePickerDialog({
  open,
  onClose,
  onPick,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: ScripturePick) => void;
  initial?: { translationId: string | null; text: string };
}) {
  const settings = useSettings();
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations, enabled: open });
  const [translationId, setTranslationId] = useState<string>("");
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) {
      setText(initial?.text ?? "");
      setTranslationId(initial?.translationId ?? setting<string | null>(settings.data, "bible.defaultTranslationId", null) ?? "");
    }
  }, [open, initial, settings.data]);
  const tid = translationId || translations.data?.[0]?.id || "";
  const books = useQuery({ queryKey: ["bible-books", tid], queryFn: () => api.bible.books(tid), enabled: open && !!tid });
  const parsed: ParseResult[] = useMemo(() => (text.trim() ? parseReferences(text, referenceBooks(books.data)) : []), [text, books.data]);
  const valid = parsed.length > 0 && parsed.every((p) => p.ok);
  const first = parsed[0];
  const preview = useQuery({
    queryKey: ["passage-preview", tid, first && first.ok ? first.ref : null],
    queryFn: () => api.bible.passage(tid, (first as Extract<ParseResult, { ok: true }>).ref),
    enabled: open && !!tid && !!first?.ok,
    retry: false,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add Scripture"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || !tid}
            onClick={() =>
              onPick({
                translationId: tid,
                references: parsed.flatMap((p) => (p.ok ? [p.ref] : [])),
                title: parsed.flatMap((p) => (p.ok ? [p.display] : [])).join("; "),
              })
            }
          >
            Add passage
          </Button>
        </>
      }
    >
      {translations.data?.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No Bible translation is installed" description="Install a translation in the Bible Library first." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_220px] gap-3">
            <Field label="Reference" hint="Examples: John 3:16 · Psalm 23 · Romans 8:28-30 · John 3:16, 18; Rom 5:8">
              <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="John 3:16" />
            </Field>
            <Field label="Translation">
              <Select value={tid} onChange={(e) => setTranslationId(e.target.value)}>
                {translations.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {parsed.map((p, i) => (
            <p key={i} className={cn("text-sm", p.ok ? "text-success" : "text-danger")}>
              {p.ok ? `✓ ${p.display}` : p.error}
            </p>
          ))}
          {preview.data && (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-bg p-3 text-sm leading-relaxed selectable">
              {preview.data.verses.map((v) => (
                <span key={`${v.chapter}:${v.verse}`}>
                  <sup className="mr-0.5 text-subtle">{v.verse}</sup>
                  {v.text}{" "}
                </span>
              ))}
            </div>
          )}
          {preview.isError && <p className="text-sm text-warning">{String((preview.error as Error)?.message ?? preview.error)}</p>}
        </div>
      )}
    </Dialog>
  );
}

export function DeckPickerDialog({
  open,
  onClose,
  onPick,
  category,
  title = "Choose slides",
  extraAction,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (deck: { id: string; title: string }) => void;
  category: DeckCategory | null;
  title?: string;
  extraAction?: { label: string; onClick: () => void };
}) {
  const decks = useQuery({ queryKey: ["decks", category], queryFn: () => api.decks.list(category), enabled: open });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="md"
      footer={extraAction ? <Button onClick={extraAction.onClick}>{extraAction.label}</Button> : undefined}
    >
      {decks.isLoading && <LoadingBlock />}
      {decks.data?.length === 0 && (
        <EmptyState icon={<Presentation />} title="No slide decks yet" description="Create slides in the Slide Editor, then add them here." />
      )}
      <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {decks.data?.map((d) => (
          <button key={d.id} type="button" onClick={() => onPick(d)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-elevated">
            <span className="text-sm">{d.title}</span>
            <span className="text-xs text-subtle">
              {d.slideCount} slide{d.slideCount === 1 ? "" : "s"} · {d.category}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

const EXTENSIONS: Record<MediaKind, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"],
  video: ["mp4", "m4v", "mov", "webm", "mkv"],
  audio: ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"],
};

/** Chooses media from the library, or imports a new file into it. */
export function MediaPickerDialog({
  open,
  onClose,
  onPick,
  kind,
  title = "Choose media",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: { id: string; title: string; kind: MediaKind }) => void;
  /** One kind, several kinds (for example a logo picture or video), or anything. */
  kind: MediaKind | MediaKind[] | null;
  title?: string;
}) {
  const qc = useQueryClient();
  const kinds = kind === null ? null : Array.isArray(kind) ? kind : [kind];
  const single = kinds?.length === 1 ? kinds[0]! : null;
  const media = useQuery({ queryKey: ["media", single ?? "all"], queryFn: () => api.media.list({ kind: single, text: null }), enabled: open });
  const items = media.data?.filter((m) => !kinds || kinds.includes(m.kind));
  const [importing, setImporting] = useState(false);
  const importFile = async () => {
    const extensions = (kinds ?? (["image", "video", "audio"] as MediaKind[])).flatMap((k) => EXTENSIONS[k]);
    const path = await pickFile({ title: "Import a file", filters: [{ name: "Media", extensions }] });
    if (!path) return;
    setImporting(true);
    try {
      const [outcome] = await api.media.importFiles([path]);
      const asset = outcome?.result?.asset;
      if (!asset) throw new Error(outcome?.error ?? "The file could not be imported.");
      if (kinds && !kinds.includes(asset.kind)) throw new Error(`That file is ${asset.kind === "image" ? "a picture" : `a ${asset.kind} file`}, which can't be used here.`);
      void qc.invalidateQueries({ queryKey: ["media"] });
      onPick(asset);
    } catch (e) {
      toast.error("The file could not be imported", e);
    } finally {
      setImporting(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<FileUp className="size-4" />} loading={importing} onClick={() => void importFile()}>
            Import file…
          </Button>
        </>
      }
    >
      {media.isLoading && <LoadingBlock />}
      {items?.length === 0 && (
        <EmptyState
          icon={single === "video" ? <Film /> : <ImageIcon />}
          title="Nothing in the Media Library yet"
          description="Use Import file… to add one from this computer."
        />
      )}
      <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto md:grid-cols-4">
        {items?.map((m) => {
          const ref = mediaRef(m);
          return (
            <button
              key={m.id}
              type="button"
              disabled={m.missing}
              onClick={() => onPick(m)}
              className="overflow-hidden rounded-md border border-border text-left hover:border-primary disabled:opacity-40"
            >
              <div className="flex aspect-video items-center justify-center bg-black">
                <img src={ref?.posterUrl ?? DEFAULT_ALBUM_URL} alt="" className="h-full w-full object-cover" />
              </div>
              <p className="truncate px-2 py-1 text-xs">{m.missing ? `Missing: ${m.title}` : m.title}</p>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
