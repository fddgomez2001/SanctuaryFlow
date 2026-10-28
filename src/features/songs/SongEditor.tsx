import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Plus, Repeat, Save, Trash2, X } from "lucide-react";
import type { Song } from "@/types/generated/Song";
import type { SongDocument } from "@/types/generated/SongDocument";
import type { SectionKind } from "@/types/generated/SectionKind";
import type { SongSectionInput } from "@/types/generated/SongSectionInput";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select, Textarea, TextField } from "@/components/ui/Field";
import { DragHandle, SortableList } from "@/components/ui/SortableList";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { SlideThumb } from "@/components/slide/SlideThumb";
import { useUnsavedGuard } from "@/app/navigation";
import { setting, useSettings } from "@/hooks/useSettings";
import { useRenderTheme } from "@/hooks/useThemes";
import { songToSlides } from "@/lib/slides/lyrics";
import { newId } from "@/lib/slides/deck";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { SECTION_COLORS } from "@/lib/slides/colors";

export const SECTION_KINDS: { value: SectionKind; label: string }[] = [
  { value: "intro", label: "Intro" },
  { value: "verse", label: "Verse" },
  { value: "prechorus", label: "Pre-Chorus" },
  { value: "chorus", label: "Chorus" },
  { value: "bridge", label: "Bridge" },
  { value: "interlude", label: "Interlude" },
  { value: "tag", label: "Tag" },
  { value: "outro", label: "Outro" },
  { value: "ending", label: "Ending" },
  { value: "custom", label: "Custom" },
];

export function emptySong(): SongDocument {
  return {
    id: null,
    title: "",
    artist: null,
    originalKey: null,
    tempo: null,
    language: null,
    category: null,
    copyrightHolder: null,
    copyrightYear: null,
    ccliNumber: null,
    source: null,
    license: null,
    notes: null,
    arrangement: null,
    themeId: null,
    audioMediaId: null,
    coverMediaId: null,
    lyricSync: null,
    tags: [],
    sections: [{ id: newId(), kind: "verse", label: "Verse 1", lyrics: "", linesPerSlide: null }],
  };
}

export function songToDocument(s: Song): SongDocument {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    originalKey: s.originalKey,
    tempo: s.tempo,
    language: s.language,
    category: s.category,
    copyrightHolder: s.copyrightHolder,
    copyrightYear: s.copyrightYear,
    ccliNumber: s.ccliNumber,
    source: s.source,
    license: s.license,
    notes: s.notes,
    arrangement: s.arrangement,
    themeId: s.themeId,
    audioMediaId: s.audioMediaId,
    coverMediaId: s.coverMediaId,
    lyricSync: s.lyricSync,
    tags: s.tags,
    sections: s.sections.map((x) => ({ id: x.id, kind: x.kind, label: x.label, lyrics: x.lyrics, linesPerSlide: x.linesPerSlide })),
  };
}

function nextLabel(kind: SectionKind, sections: SongSectionInput[]): string {
  const name = SECTION_KINDS.find((k) => k.value === kind)?.label ?? "Section";
  if (kind !== "verse") return sections.some((s) => s.kind === kind) ? `${name} ${sections.filter((s) => s.kind === kind).length + 1}` : name;
  return `Verse ${sections.filter((s) => s.kind === "verse").length + 1}`;
}

const opt = (v: string) => (v.trim() ? v : null);

/** Previews a document as slides, the same way it will be presented. */
function previewSong(doc: SongDocument): Song {
  return {
    ...doc,
    id: doc.id ?? "preview",
    title: doc.title || "Untitled song",
    sections: doc.sections.map((s) => ({ id: s.id ?? "", kind: s.kind, label: s.label, lyrics: s.lyrics, linesPerSlide: s.linesPerSlide })),
    isFavorite: false,
    useCount: 0,
    lastUsedAt: null,
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    revision: 0,
  };
}

/**
 * Adds or edits a song: its title, artist and lyrics. Other details a song
 * may carry from an import (key, copyright, notes…) are kept as they are.
 */
export function SongEditor({ initial, artists = [], onSaved, onCancel }: { initial: SongDocument; artists?: string[]; onSaved: (song: Song) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState<SongDocument>(initial);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();
  const { theme, media } = useRenderTheme(doc.themeId, "song");
  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(initial), [doc, initial]);
  useUnsavedGuard(dirty, "This song has changes that have not been saved.");

  useEffect(() => setDoc(initial), [initial]);

  const save = useMutation({
    mutationFn: () => api.songs.save(doc),
    onSuccess: async (song) => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["songs"] });
      await qc.invalidateQueries({ queryKey: ["song-facets"] });
      qc.setQueryData(["song", song.id], song);
      toast.success("Song saved");
      onSaved(song);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const set = <K extends keyof SongDocument>(key: K, value: SongDocument[K]) => setDoc((d) => ({ ...d, [key]: value }));
  const setSection = (id: string, patch: Partial<SongSectionInput>) =>
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const addSection = (kind: SectionKind) =>
    setDoc((d) => ({ ...d, sections: [...d.sections, { id: newId(), kind, label: nextLabel(kind, d.sections), lyrics: "", linesPerSlide: null }] }));
  const removeSection = (id: string) =>
    setDoc((d) => {
      const arrangement = d.arrangement?.filter((a) => a !== id) ?? null;
      return { ...d, sections: d.sections.filter((s) => s.id !== id), arrangement: arrangement?.length ? arrangement : null };
    });

  const defaultLines = setting(settings.data, "presentation.maxLinesPerSlide", 4);
  const slides = useMemo(() => songToSlides(previewSong(doc), "preview", { maxLinesPerSlide: defaultLines }), [doc, defaultLines]);
  const arrangement = doc.arrangement ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-shortcuts="off">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="truncate text-base font-semibold">{doc.id ? `Edit: ${initial.title}` : "New song"}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!doc.title.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-text" role="alert">{error}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Title" value={doc.title} onChange={(e) => set("title", e.target.value)} autoFocus={!doc.id} required />
              <TextField
                label="Artist"
                value={doc.artist ?? ""}
                list="song-artists"
                onChange={(e) => set("artist", opt(e.target.value))}
                placeholder="Hillsong, Planetshakers, your worship leader…"
              />
              <datalist id="song-artists">
                {artists.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Lyrics</h3>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" icon={<ClipboardPaste className="size-3.5" />} onClick={() => setPasteOpen(true)}>
                    Paste whole song
                  </Button>
                  <Select
                    aria-label="Add section"
                    className="h-7 w-40 text-xs"
                    value=""
                    onChange={(e) => e.target.value && addSection(e.target.value as SectionKind)}
                  >
                    <option value="">+ Add section…</option>
                    {SECTION_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <p className="mb-3 text-xs text-subtle">
                Leave a blank line inside a section to start a new slide. Long sections are split automatically. Choose “Line by line” on a
                section (for example the chorus) to show it one line at a time.
              </p>
              <SortableList
                items={doc.sections}
                getId={(s) => s.id!}
                onReorder={(sections) => set("sections", sections)}
                className="space-y-3"
                render={(s, handle) => (
                  <div className="rounded-md border border-l-4 border-border bg-bg" style={{ borderLeftColor: SECTION_COLORS[s.kind] }}>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
                      <DragHandle handle={handle} label={`Move ${s.label}`} />
                      <Select aria-label="Section type" className="h-7 w-32 text-xs" value={s.kind} onChange={(e) => setSection(s.id!, { kind: e.target.value as SectionKind })}>
                        {SECTION_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </Select>
                      <Input aria-label="Section name" className="h-7 min-w-24 max-w-52 flex-1 text-xs" value={s.label} onChange={(e) => setSection(s.id!, { label: e.target.value })} />
                      <Select
                        aria-label={`${s.label} lines per slide`}
                        title="How many lyric lines each slide of this section shows"
                        className={cn("h-7 w-40 shrink-0 text-xs", s.linesPerSlide === 1 && "border-primary")}
                        value={s.linesPerSlide ?? ""}
                        onChange={(e) => setSection(s.id!, { linesPerSlide: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Default ({defaultLines} per slide)</option>
                        <option value={1}>Line by line</option>
                        {[2, 3, 4, 5, 6, 8].map((n) => (
                          <option key={n} value={n}>
                            {n} lines per slide
                          </option>
                        ))}
                      </Select>
                      <div className="flex-1" />
                      <IconButton
                        size="sm"
                        label="Add to arrangement"
                        icon={<Repeat className="size-3.5" />}
                        onClick={() => set("arrangement", [...(doc.arrangement ?? doc.sections.map((x) => x.id!)), s.id!])}
                      />
                      <IconButton size="sm" label="Delete section" icon={<Trash2 className="size-3.5" />} onClick={() => removeSection(s.id!)} />
                    </div>
                    <Textarea
                      aria-label={`${s.label} lyrics`}
                      value={s.lyrics}
                      rows={Math.min(14, Math.max(4, s.lyrics.split("\n").length + 1))}
                      onChange={(e) => setSection(s.id!, { lyrics: e.target.value })}
                      className="rounded-t-none border-0 font-[inherit] leading-relaxed focus:ring-0"
                      placeholder="Type the lyrics…"
                    />
                  </div>
                )}
              />
              {doc.sections.length === 0 && (
                <Button className="mt-2" icon={<Plus className="size-4" />} onClick={() => addSection("verse")}>
                  Add a verse
                </Button>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Presentation order</h3>
                {doc.arrangement && (
                  <Button size="sm" variant="ghost" onClick={() => set("arrangement", null)}>
                    Use section order
                  </Button>
                )}
              </div>
              {!doc.arrangement ? (
                <p className="text-xs text-subtle">
                  Sections are presented in the order above. Use <Repeat className="inline size-3" /> on a section to build a custom order with repeats (for example Verse 1, Chorus, Verse 2, Chorus).
                </p>
              ) : (
                <SortableList
                  horizontal
                  items={arrangement.map((id, i) => ({ key: `${id}#${i}`, id }))}
                  getId={(a) => a.key}
                  onReorder={(list) => set("arrangement", list.map((a) => a.id))}
                  className="flex flex-wrap gap-1.5"
                  render={(a, handle) => {
                    const sec = doc.sections.find((s) => s.id === a.id);
                    return (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-md border border-l-4 border-border bg-elevated py-0.5 pr-1 text-xs"
                        style={sec ? { borderLeftColor: SECTION_COLORS[sec.kind] } : undefined}
                      >
                        <DragHandle handle={handle} />
                        {sec?.label ?? "Missing"}
                        <button
                          type="button"
                          aria-label="Remove from order"
                          className="ml-1 text-subtle hover:text-text"
                          onClick={() => {
                            const idx = Number(a.key.split("#")[1]);
                            const next = arrangement.filter((_, i) => i !== idx);
                            set("arrangement", next.length ? next : null);
                          }}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  }}
                />
              )}
            </div>
          </div>

          <aside className="space-y-2">
            <h3 className="text-sm font-semibold">Slides ({slides.length})</h3>
            {slides.length === 0 && <p className="text-xs text-subtle">Type some lyrics to see the slides.</p>}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              {slides.map((s, i) => (
                <SlideThumb key={s.id} slide={s} theme={theme} media={media} index={i} />
              ))}
            </div>
          </aside>
        </div>
      </div>
      <PasteLyricsDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onParsed={async (sections) => {
          const hasLyrics = doc.sections.some((s) => s.lyrics.trim());
          if (hasLyrics) {
            const ok = await confirm({ title: "Replace the current lyrics?", message: "The pasted song will replace all sections.", confirmLabel: "Replace" });
            if (!ok) return;
          }
          setDoc((d) => ({ ...d, sections: sections.map((s) => ({ ...s, id: newId() })), arrangement: null }));
          setPasteOpen(false);
        }}
      />
    </div>
  );
}

function PasteLyricsDialog({ open, onClose, onParsed }: { open: boolean; onClose: () => void; onParsed: (s: SongSectionInput[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Paste a whole song"
      description="Section headers like [Verse 1], Chorus: or Koro start new sections. Blank lines inside a section start a new slide."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const sections = await api.songs.parseLyrics(text);
                if (!sections.length) toast.warning("No lyrics were found in the pasted text.");
                else {
                  onParsed(sections);
                  setText("");
                }
              } catch (e) {
                toast.error("The lyrics could not be read", e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Use these lyrics
          </Button>
        </>
      }
    >
      <Textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder={"[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…"} autoFocus />
    </Dialog>
  );
}
