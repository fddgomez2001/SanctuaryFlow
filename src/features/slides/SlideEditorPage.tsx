import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eye,
  ImagePlus,
  LayoutTemplate,
  MonitorPlay,
  Plus,
  Presentation,
  Save,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import type { DeckCategory } from "@/types/generated/DeckCategory";
import type { SlideDeck } from "@/types/generated/SlideDeck";
import { api } from "@/services/api";
import { useNav, useUnsavedGuard } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea, TextField } from "@/components/ui/Field";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { EmptyState, LoadingBlock } from "@/components/ui/misc";
import { DragHandle, SortableList } from "@/components/ui/SortableList";
import { toast } from "@/components/ui/Toast";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { useMediaRefs, useRenderTheme, useThemes } from "@/hooks/useThemes";
import { blankDeckSlide, deckSlideMediaIds, imageElement, newId, normalizeDeckSlides, shapeElement, textElement } from "@/lib/slides/deck";
import type { DeckSlide, ElementBox, SlideElement } from "@/lib/slides/types";
import { FONT_CHOICES, normalizeTheme, themeMediaIds, type ThemeBackground, type ThemeSettings } from "@/lib/theme";
import type { MediaRef } from "@/services/presentation-engine/render-model";
import { MediaPickerDialog } from "@/features/services/pickers";
import { ColorField, NumberField } from "@/features/themes/ThemesPage";
import { presentDeck } from "@/services/presentation-engine/quick";
import { cn } from "@/lib/cn";

const CATEGORY_LABEL: Record<DeckCategory, string> = { announcement: "Announcements", sermon: "Sermon slides", custom: "Custom slides", template: "Templates" };

export function SlideEditorPage() {
  const qc = useQueryClient();
  const params = useNav((s) => s.params);
  const [category, setCategory] = useState<DeckCategory | null>(null);
  const [deckId, setDeckId] = useState<string | null>(params.deckId ?? null);
  const decks = useQuery({ queryKey: ["decks", category], queryFn: () => api.decks.list(category) });
  useEffect(() => {
    if (params.deckId) setDeckId(params.deckId);
  }, [params.deckId]);

  const create = async (cat: DeckCategory, fromTemplate?: string) => {
    try {
      let slides: unknown = [blankDeckSlide()];
      let title = cat === "announcement" ? "Announcements" : cat === "sermon" ? "Sermon" : cat === "template" ? "Template" : "Slides";
      let themeId: string | null = null;
      if (fromTemplate) {
        const t = await api.decks.get(fromTemplate);
        slides = normalizeDeckSlides(t.slides).map((s) => ({ ...s, id: newId(), elements: s.elements.map((e) => ({ ...e, id: newId() })) }));
        title = t.title;
        themeId = t.themeId;
      }
      const d = await api.decks.save({ id: null, title, category: cat, themeId, slides: slides as unknown[] });
      await qc.invalidateQueries({ queryKey: ["decks"] });
      setDeckId(d.id);
    } catch (e) {
      toast.error("Could not create slides", e);
    }
  };

  const templates = useQuery({ queryKey: ["decks", "template"], queryFn: () => api.decks.list("template") });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-3">
          <h1 className="text-base font-semibold">Slide Editor</h1>
          <Select
            aria-label="New slides"
            value=""
            onChange={(e) => {
              const [cat, tpl] = e.target.value.split(":");
              if (cat) void create(cat as DeckCategory, tpl || undefined);
            }}
          >
            <option value="">+ New slides…</option>
            <option value="announcement">Announcements</option>
            <option value="sermon">Sermon slides</option>
            <option value="custom">Custom slides</option>
            <option value="template">Template</option>
            {templates.data && templates.data.length > 0 && (
              <optgroup label="From a template">
                {templates.data.map((t) => (
                  <option key={t.id} value={`custom:${t.id}`}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <Select aria-label="Filter" value={category ?? ""} onChange={(e) => setCategory((e.target.value || null) as DeckCategory | null)}>
            <option value="">All slides</option>
            {(Object.keys(CATEGORY_LABEL) as DeckCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {decks.isLoading && <LoadingBlock />}
          {decks.data?.length === 0 && <p className="p-3 text-sm text-subtle">No slides yet. Create announcements, sermon points or a reusable template.</p>}
          {decks.data?.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDeckId(d.id)}
              className={cn("block w-full rounded-md px-2.5 py-2 text-left", deckId === d.id ? "bg-primary/15" : "hover:bg-elevated")}
            >
              <p className="truncate text-sm">{d.title}</p>
              <p className="text-xs text-subtle">
                {CATEGORY_LABEL[d.category]} · {d.slideCount} slide{d.slideCount === 1 ? "" : "s"}
              </p>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {deckId ? (
          <DeckLoader key={deckId} id={deckId} onDeleted={() => setDeckId(null)} onDuplicated={setDeckId} />
        ) : (
          <EmptyState
            icon={<Presentation />}
            title="Choose or create slides"
            description="Build announcement slides, sermon points and reusable layouts. Slides use your theme unless you set their own background."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void create("announcement")}>
                New announcement slides
              </Button>
            }
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}

function DeckLoader({ id, onDeleted, onDuplicated }: { id: string; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const deck = useQuery({ queryKey: ["deck", id], queryFn: () => api.decks.get(id), staleTime: Infinity });
  if (deck.isLoading) return <LoadingBlock />;
  if (!deck.data) return <EmptyState title="These slides could not be opened." />;
  return <DeckEditor deck={deck.data} onDeleted={onDeleted} onDuplicated={onDuplicated} />;
}

function DeckEditor({ deck, onDeleted, onDuplicated }: { deck: SlideDeck; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const qc = useQueryClient();
  const initialSlides = useMemo(() => normalizeDeckSlides(deck.slides), [deck.slides]);
  const [title, setTitle] = useState(deck.title);
  const [category, setCategory] = useState<DeckCategory>(deck.category);
  const [themeId, setThemeId] = useState<string | null>(deck.themeId);
  const [slides, setSlides] = useState<DeckSlide[]>(initialSlides.length ? initialSlides : [blankDeckSlide()]);
  const [current, setCurrent] = useState(0);
  const [selectedEl, setSelectedEl] = useState<string | null>(null);
  const [picking, setPicking] = useState<null | "image" | "background" | { replace: string }>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const themes = useThemes();
  const { theme } = useRenderTheme(themeId, category === "sermon" ? "scripture" : "announcement");
  const slide = slides[Math.min(current, slides.length - 1)]!;
  const mediaIds = useMemo(() => [...slides.flatMap(deckSlideMediaIds), ...themeMediaIds(theme)], [slides, theme]);
  const media = useMediaRefs(mediaIds);
  const dirty =
    title !== deck.title || category !== deck.category || themeId !== deck.themeId || JSON.stringify(slides) !== JSON.stringify(initialSlides.length ? initialSlides : slides);
  useUnsavedGuard(dirty, "These slides have unsaved changes.");

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.decks.save({ id: deck.id, title, category, themeId, slides: slides as unknown[] });
      qc.setQueryData(["deck", deck.id], saved);
      await qc.invalidateQueries({ queryKey: ["decks"] });
      toast.success("Slides saved");
    } catch (e) {
      toast.error("The slides could not be saved", e);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const updateSlide = (patch: Partial<DeckSlide>) => setSlides((all) => all.map((s, i) => (i === current ? { ...s, ...patch } : s)));
  const updateEl = (id: string, patch: Partial<SlideElement>) =>
    updateSlide({ elements: slide.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as SlideElement) : e)) });
  const addEl = (el: SlideElement) => {
    updateSlide({ elements: [...slide.elements, el] });
    setSelectedEl(el.id);
  };
  const el = slide.elements.find((e) => e.id === selectedEl) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-60 font-semibold" aria-label="Slides title" />
        <Select value={category} onChange={(e) => setCategory(e.target.value as DeckCategory)} className="w-40" aria-label="Category">
          {(Object.keys(CATEGORY_LABEL) as DeckCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select value={themeId ?? ""} onChange={(e) => setThemeId(e.target.value || null)} className="w-44" aria-label="Theme">
          <option value="">Default theme</option>
          {themes.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <div className="mx-1 h-6 border-l border-border" />
        <Button size="sm" icon={<Type className="size-3.5" />} onClick={() => addEl(textElement())}>
          Text
        </Button>
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking("image")}>
          Image
        </Button>
        <Button size="sm" icon={<Square className="size-3.5" />} onClick={() => addEl(shapeElement())}>
          Shape
        </Button>
        <div className="ml-auto flex gap-1.5">
          <IconButton label="Preview" icon={<Eye className="size-4" />} onClick={() => setPreview(true)} />
          <IconButton label="Present now" icon={<MonitorPlay className="size-4" />} onClick={async () => {
            if (dirty) await save();
            void presentDeck({ id: deck.id, title });
          }} />
          <IconButton
            label="Save as template"
            icon={<LayoutTemplate className="size-4" />}
            onClick={async () => {
              try {
                const t = await api.decks.save({ id: null, title: `${title} template`, category: "template", themeId, slides: slides as unknown[] });
                await qc.invalidateQueries({ queryKey: ["decks"] });
                toast.success("Template saved", t.title);
              } catch (e) {
                toast.error("Could not save the template", e);
              }
            }}
          />
          <IconButton
            label="Duplicate"
            icon={<Copy className="size-4" />}
            onClick={async () => {
              try {
                const d = await api.decks.duplicate(deck.id);
                await qc.invalidateQueries({ queryKey: ["decks"] });
                onDuplicated(d.id);
              } catch (e) {
                toast.error("Could not duplicate", e);
              }
            }}
          />
          <IconButton
            label="Delete"
            icon={<Trash2 className="size-4" />}
            onClick={async () => {
              if (!(await confirm({ title: `Delete “${deck.title}”?`, message: "Service items that use these slides will show them as missing.", confirmLabel: "Delete", danger: true }))) return;
              try {
                await api.decks.remove(deck.id);
                await qc.invalidateQueries({ queryKey: ["decks"] });
                onDeleted();
              } catch (e) {
                toast.error("Could not delete", e);
              }
            }}
          />
          <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || !title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-48 shrink-0 flex-col border-r border-border">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <SortableList
              items={slides}
              getId={(s) => s.id}
              onReorder={(next) => {
                const id = slide.id;
                setSlides(next);
                setCurrent(next.findIndex((s) => s.id === id));
              }}
              className="space-y-2"
              render={(s, handle) => {
                const i = slides.indexOf(s);
                return (
                  <div className={cn("group rounded-md border-2", i === current ? "border-primary" : "border-border")}>
                    <button type="button" className="relative block aspect-video w-full overflow-hidden" onClick={() => { setCurrent(i); setSelectedEl(null); }}>
                      <SlideRenderer content={{ kind: "custom", slide: s }} slideKey={s.id} theme={theme} output="normal" media={media.data ?? {}} logo={null} aspect={16 / 9} className="absolute inset-0 overflow-hidden" />
                    </button>
                    <div className="flex items-center px-1">
                      <DragHandle handle={handle} />
                      <span className="flex-1 text-[11px] text-subtle">{i + 1}</span>
                      <IconButton
                        size="sm"
                        label="Duplicate slide"
                        icon={<Copy className="size-3" />}
                        onClick={() => {
                          const copy = { ...s, id: newId(), elements: s.elements.map((e) => ({ ...e, id: newId() })) };
                          setSlides([...slides.slice(0, i + 1), copy, ...slides.slice(i + 1)]);
                          setCurrent(i + 1);
                        }}
                      />
                      <IconButton
                        size="sm"
                        label="Delete slide"
                        icon={<Trash2 className="size-3" />}
                        disabled={slides.length === 1}
                        onClick={() => {
                          setSlides(slides.filter((x) => x.id !== s.id));
                          setCurrent(Math.max(0, Math.min(current, slides.length - 2)));
                        }}
                      />
                    </div>
                  </div>
                );
              }}
            />
          </div>
          <div className="border-t border-border p-2">
            <Button
              className="w-full"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setSlides([...slides, blankDeckSlide()]);
                setCurrent(slides.length);
                setSelectedEl(null);
              }}
            >
              Add slide
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center bg-bg p-6">
          <Canvas
            slide={slide}
            theme={theme}
            media={media.data ?? {}}
            selected={selectedEl}
            onSelect={setSelectedEl}
            onMove={(id, box) => updateEl(id, { box })}
          />
        </div>

        <div className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-border p-4" data-shortcuts="off">
          {el ? (
            <ElementPanel
              el={el}
              onChange={(patch) => updateEl(el.id, patch)}
              onDelete={() => {
                updateSlide({ elements: slide.elements.filter((e) => e.id !== el.id) });
                setSelectedEl(null);
              }}
              onOrder={(dir) => {
                const others = slide.elements.filter((e) => e.id !== el.id);
                updateSlide({ elements: dir === "front" ? [...others, el] : [el, ...others] });
              }}
              onPickImage={() => setPicking({ replace: el.id })}
            />
          ) : (
            <SlidePanel slide={slide} onChange={updateSlide} onPickBackground={() => setPicking("background")} />
          )}
        </div>
      </div>

      <MediaPickerDialog
        open={picking !== null}
        kind={picking === "background" ? null : "image"}
        title={picking === "background" ? "Choose a background" : "Choose an image"}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          if (picking === "background") {
            const base = slide.background ?? normalizeTheme(null).background;
            updateSlide({ background: { ...base, type: m.kind === "video" ? "video" : "image", mediaId: m.id } });
          } else if (picking && typeof picking === "object") updateEl(picking.replace, { mediaId: m.id });
          else addEl(imageElement(m.id));
          setPicking(null);
        }}
      />
      <Dialog open={preview} onOpenChange={setPreview} title={`Preview — slide ${current + 1}`} size="xl">
        <div className="relative w-full overflow-hidden rounded-md" style={{ aspectRatio: 16 / 9 }}>
          <SlideRenderer content={{ kind: "custom", slide }} slideKey={slide.id} theme={theme} output="normal" media={media.data ?? {}} logo={null} aspect={16 / 9} className="absolute inset-0 overflow-hidden" />
        </div>
      </Dialog>
    </div>
  );
}

/** The editable slide: rendered content with draggable selection boxes on top. */
function Canvas({
  slide,
  theme,
  media,
  selected,
  onSelect,
  onMove,
}: {
  slide: DeckSlide;
  theme: ThemeSettings;
  media: Record<string, MediaRef>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, box: ElementBox) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; x: number; y: number; box: ElementBox } | null>(null);

  const start = (e: React.PointerEvent, id: string, mode: "move" | "resize", box: ElementBox) => {
    e.stopPropagation();
    onSelect(id);
    drag.current = { id, mode, x: e.clientX, y: e.clientY, box };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const r = ref.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = ((e.clientX - d.x) / r.width) * 100;
    const dy = ((e.clientY - d.y) / r.height) * 100;
    const round = (n: number) => Math.round(n * 2) / 2;
    if (d.mode === "move") onMove(d.id, { ...d.box, x: round(d.box.x + dx), y: round(d.box.y + dy) });
    else onMove(d.id, { ...d.box, w: Math.max(2, round(d.box.w + dx)), h: Math.max(2, round(d.box.h + dy)) });
  };

  const sel = slide.elements.find((x) => x.id === selected);
  return (
    <div
      ref={ref}
      tabIndex={0}
      className="relative w-full max-w-5xl overflow-hidden rounded-md border border-border-strong shadow-2xl outline-none"
      style={{ aspectRatio: 16 / 9 }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (!sel) return;
        const step = e.shiftKey ? 2 : 0.5;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (delta) {
          e.preventDefault();
          onMove(sel.id, { ...sel.box, x: sel.box.x + delta[0]!, y: sel.box.y + delta[1]! });
        }
      }}
    >
      <SlideRenderer content={{ kind: "custom", slide }} slideKey={slide.id} theme={theme} output="normal" media={media} logo={null} aspect={16 / 9} className="absolute inset-0 overflow-hidden" />
      <div className="pointer-events-none absolute border border-dashed border-white/25" style={{ inset: `${theme.safeMargin}%` }} />
      {slide.elements.map((x) => (
        <div
          key={x.id}
          onPointerDown={(e) => start(e, x.id, "move", x.box)}
          className={cn("absolute cursor-move", x.id === selected ? "outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-white/40")}
          style={{ left: `${x.box.x}%`, top: `${x.box.y}%`, width: `${x.box.w}%`, height: `${x.box.h}%` }}
        >
          {x.id === selected && (
            <span
              onPointerDown={(e) => start(e, x.id, "resize", x.box)}
              className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-primary"
              aria-label="Resize"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function BoxFields({ box, onChange }: { box: ElementBox; onChange: (b: ElementBox) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(["x", "y", "w", "h"] as const).map((k) => (
        <NumberField key={k} label={k.toUpperCase()} value={box[k]} min={k === "w" || k === "h" ? 1 : -50} max={150} step={0.5} onChange={(v) => onChange({ ...box, [k]: v })} />
      ))}
    </div>
  );
}

function ElementPanel({
  el,
  onChange,
  onDelete,
  onOrder,
  onPickImage,
}: {
  el: SlideElement;
  onChange: (p: Partial<SlideElement>) => void;
  onDelete: () => void;
  onOrder: (dir: "front" | "back") => void;
  onPickImage: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">{el.type}</h3>
        <div className="flex">
          <IconButton size="sm" label="Bring to front" icon={<ArrowUpToLine className="size-3.5" />} onClick={() => onOrder("front")} />
          <IconButton size="sm" label="Send to back" icon={<ArrowDownToLine className="size-3.5" />} onClick={() => onOrder("back")} />
          <IconButton size="sm" label="Delete" icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
        </div>
      </div>
      {el.type === "text" && (
        <>
          <Field label="Text">
            <Textarea rows={5} value={el.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <Field label="Font">
            <Select value={el.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
              {[...new Set([el.fontFamily, ...FONT_CHOICES])].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Size" value={el.fontSize} min={8} max={300} onChange={(v) => onChange({ fontSize: v })} />
            <Field label="Weight">
              <Select value={el.fontWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </Field>
            <ColorField label="Colour" value={el.color} onChange={(v) => onChange({ color: v })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Align">
              <Select value={el.align} onChange={(e) => onChange({ align: e.target.value as typeof el.align })}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </Select>
            </Field>
            <Field label="Vertical">
              <Select value={el.verticalAlign} onChange={(e) => onChange({ verticalAlign: e.target.value as typeof el.verticalAlign })}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </Select>
            </Field>
            <NumberField label="Line height" value={el.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => onChange({ lineHeight: v })} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Checkbox checked={el.autoFit} onChange={(v) => onChange({ autoFit: v })} label="Shrink to fit" />
            <Checkbox checked={el.shadow} onChange={(v) => onChange({ shadow: v })} label="Shadow" />
            <Checkbox checked={el.italic} onChange={(v) => onChange({ italic: v })} label="Italic" />
            <Checkbox checked={el.uppercase} onChange={(v) => onChange({ uppercase: v })} label="Capitals" />
          </div>
        </>
      )}
      {el.type === "image" && (
        <>
          <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={onPickImage}>
            Change image
          </Button>
          <Field label="Fit">
            <Select value={el.fit} onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}>
              <option value="contain">Show all</option>
              <option value="cover">Fill and crop</option>
            </Select>
          </Field>
          {el.fit === "cover" && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Crop focus X (%)" value={el.cropX} min={0} max={100} onChange={(v) => onChange({ cropX: v })} />
              <NumberField label="Crop focus Y (%)" value={el.cropY} min={0} max={100} onChange={(v) => onChange({ cropY: v })} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Opacity (%)" value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => onChange({ opacity: v / 100 })} />
            <NumberField label="Corner radius" value={el.radius} min={0} max={500} onChange={(v) => onChange({ radius: v })} />
          </div>
        </>
      )}
      {el.type === "shape" && (
        <div className="grid grid-cols-3 gap-2">
          <ColorField label="Colour" value={el.color} onChange={(v) => onChange({ color: v })} />
          <NumberField label="Opacity (%)" value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => onChange({ opacity: v / 100 })} />
          <NumberField label="Radius" value={el.radius} min={0} max={500} onChange={(v) => onChange({ radius: v })} />
        </div>
      )}
      <Field label="Position and size (% of the slide)">
        <BoxFields box={el.box} onChange={(box) => onChange({ box })} />
      </Field>
      <p className="text-xs text-subtle">Drag on the slide to move; drag the corner to resize; arrow keys nudge (Shift for larger steps).</p>
    </>
  );
}

function SlidePanel({ slide, onChange, onPickBackground }: { slide: DeckSlide; onChange: (p: Partial<DeckSlide>) => void; onPickBackground: () => void }) {
  const bg: ThemeBackground | null = slide.background;
  const base = normalizeTheme(null).background;
  return (
    <>
      <h3 className="text-sm font-semibold">Slide</h3>
      <Field label="Background">
        <Select
          value={bg ? bg.type : "theme"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "theme") onChange({ background: null });
            else onChange({ background: { ...(bg ?? base), type: v as ThemeBackground["type"] } });
          }}
        >
          <option value="theme">Use the theme background</option>
          <option value="black">Black</option>
          <option value="color">Solid colour</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </Select>
      </Field>
      {bg && bg.type !== "black" && <ColorField label="Colour" value={bg.color} onChange={(v) => onChange({ background: { ...bg, color: v } })} />}
      {bg && (bg.type === "image" || bg.type === "video") && (
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={onPickBackground}>
          {bg.mediaId ? "Change media" : "Choose media"}
        </Button>
      )}
      {bg && (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Overlay" value={bg.overlayColor} onChange={(v) => onChange({ background: { ...bg, overlayColor: v } })} />
          <NumberField label="Overlay %" value={Math.round(bg.overlayOpacity * 100)} min={0} max={100} onChange={(v) => onChange({ background: { ...bg, overlayOpacity: v / 100 } })} />
        </div>
      )}
      <TextField label="Operator notes" value={slide.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} hint="Shown only on the operator screen." />
      <p className="text-xs text-subtle">Select an element on the slide to edit it.</p>
    </>
  );
}
