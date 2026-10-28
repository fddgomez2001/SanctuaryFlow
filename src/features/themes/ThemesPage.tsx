import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ImagePlus, Play, Plus, Save, Trash2 } from "lucide-react";
import type { Theme } from "@/types/generated/Theme";
import type { ThemeCategory } from "@/types/generated/ThemeCategory";
import { api } from "@/services/api";
import { useUnsavedGuard } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, TextField } from "@/components/ui/Field";
import { confirm } from "@/components/ui/Dialog";
import { Badge, EmptyState, LoadingBlock } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { THEMES_KEY, useMediaRefs, useThemes } from "@/hooks/useThemes";
import { BACKGROUND_STYLES, DEFAULT_THEME, FONT_CHOICES, fontLabel, normalizeTheme, TEXT_CASES, themeMediaIds, TRANSITIONS, type BackgroundStyle, type TextCase, type ThemeSettings, type TransitionType } from "@/lib/theme";
import type { SlideContent } from "@/lib/slides/types";
import { MediaPickerDialog } from "@/features/services/pickers";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";

type Sample = "lyrics" | "scripture" | "announcement";

const SAMPLE_LYRICS: SlideContent = {
  kind: "lyrics",
  lines: ["We lift our voices, we lift our hands", "Together we gather in Your name", "Your faithfulness from age to age"],
  sectionLabel: "Verse 1",
  songTitle: "Sample Song",
  footer: "Sample Song — Example Writer · © 2026 Example Music · CCLI Song #0000000",
};

/** The next slide in the preview, so a transition has somewhere to go. */
const SAMPLE_LYRICS_NEXT: SlideContent = {
  ...SAMPLE_LYRICS,
  lines: ["Morning light is breaking through", "Every shadow fades from view", "We stand in wonder at Your grace"],
  sectionLabel: "Chorus",
};

const SAMPLE_ANNOUNCEMENTS: SlideContent[] = [
  { kind: "text", title: "Fellowship Lunch", body: "Join us after the service in the fellowship hall.\nEveryone is welcome!" },
  { kind: "text", title: "Prayer Meeting", body: "Wednesday at 7 pm in the chapel.\nCome and pray with us." },
];

export function ThemesPage() {
  const themes = useThemes();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && themes.data?.[0]) setSelectedId(themes.data[0].id);
  }, [themes.data, selectedId]);
  const selected = themes.data?.find((t) => t.id === selectedId) ?? null;
  const qc = useQueryClient();

  const create = async () => {
    try {
      const t = await api.themes.save({ id: null, name: "New theme", category: "general", settings: { ...DEFAULT_THEME } });
      await qc.invalidateQueries({ queryKey: THEMES_KEY });
      setSelectedId(t.id);
    } catch (e) {
      toast.error("Could not create a theme", e);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border p-3">
          <h1 className="text-base font-semibold">Themes</h1>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void create()}>
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {themes.isLoading && <LoadingBlock />}
          {themes.data?.map((t) => (
            <ThemeCard key={t.id} theme={t} active={t.id === selectedId} onClick={() => setSelectedId(t.id)} />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <ThemeEditor key={selected.id} theme={selected} onDeleted={() => setSelectedId(null)} onDuplicated={setSelectedId} />
        ) : (
          <EmptyState title="Select a theme" className="h-full" />
        )}
      </div>
    </div>
  );
}

function ThemeCard({ theme, active, onClick }: { theme: Theme; active: boolean; onClick: () => void }) {
  const t = useMemo(() => normalizeTheme(theme.settings), [theme.settings]);
  const media = useMediaRefs(themeMediaIds(t));
  return (
    <button type="button" onClick={onClick} className={cn("w-full overflow-hidden rounded-md border-2 text-left", active ? "border-primary" : "border-border hover:border-border-strong")}>
      <div className="relative aspect-video">
        <SlideRenderer content={SAMPLE_LYRICS} slideKey="card" theme={t} output="normal" media={media.data ?? {}} logo={null} aspect={16 / 9} className="absolute inset-0 overflow-hidden" />
      </div>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="truncate text-xs">{theme.name}</span>
        {theme.isBuiltin && <Badge>Built-in</Badge>}
      </div>
    </button>
  );
}

function ThemeEditor({ theme, onDeleted, onDuplicated }: { theme: Theme; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const initial = useMemo(() => normalizeTheme(theme.settings), [theme.settings]);
  const [name, setName] = useState(theme.name);
  const [category, setCategory] = useState<ThemeCategory>(theme.category);
  const [s, setS] = useState<ThemeSettings>(initial);
  const [sample, setSample] = useState<Sample>("lyrics");
  const [picking, setPicking] = useState<null | "background" | "logo">(null);
  // The preview plays a transition by moving to the other sample slide.
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState<TransitionType | null>(null);
  const stopTimer = useRef(0);
  const play = useCallback(
    (type: TransitionType) => {
      if (type === "none" || s.transition.durationMs <= 0) {
        setPlaying(null);
        setTurn((t) => t + 1);
        return;
      }
      setPlaying(type);
      setTurn((t) => t + 1);
      window.clearTimeout(stopTimer.current);
      stopTimer.current = window.setTimeout(() => setPlaying(null), s.transition.durationMs + 250);
    },
    [s.transition.durationMs],
  );
  useEffect(() => () => window.clearTimeout(stopTimer.current), []);
  const [saving, setSaving] = useState(false);
  const media = useMediaRefs(themeMediaIds(s));
  const dirty = name !== theme.name || category !== theme.category || JSON.stringify(s) !== JSON.stringify(initial);
  useUnsavedGuard(dirty, "This theme has unsaved changes.");

  const translationId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const verse = useQuery({
    queryKey: ["theme-sample-verse", translationId],
    queryFn: () => api.bible.passage(translationId!, { bookId: "PSA", chapter: 23, verseStart: 1, chapterEnd: null, verseEnd: 3 }),
    enabled: !!translationId,
    retry: false,
  });
  const second = turn % 2 === 1;
  const verses = verse.data?.verses.map((v) => ({ number: String(v.verse), text: v.text.replace(/¶\s*/g, "") })) ?? [];
  // Verses 1–2, then verse 3.
  const shownVerses = second && verses.length > 1 ? verses.slice(-1) : verses.slice(0, Math.max(1, verses.length - 1));
  const content: SlideContent =
    sample === "lyrics"
      ? second
        ? SAMPLE_LYRICS_NEXT
        : SAMPLE_LYRICS
      : sample === "announcement"
        ? SAMPLE_ANNOUNCEMENTS[second ? 1 : 0]!
        : verse.data
          ? {
              kind: "scripture",
              verses: shownVerses,
              reference: `${verse.data.bookName} 23:${shownVerses[0]?.number ?? 1}${shownVerses.length > 1 ? `–${shownVerses.at(-1)!.number}` : ""}`,
              translation: verse.data.translationCode,
            }
          : { kind: "text", title: null, body: "Install a Bible translation to preview Scripture with this theme." };
  // While a transition plays, the preview uses that effect (even one only hovered).
  const previewTheme = useMemo<ThemeSettings>(() => (playing ? { ...s, transition: { ...s.transition, type: playing } } : s), [s, playing]);

  const set = <K extends keyof ThemeSettings>(k: K, v: ThemeSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setBg = (patch: Partial<ThemeSettings["background"]>) => setS((x) => ({ ...x, background: { ...x.background, ...patch } }));
  const setRef = (patch: Partial<ThemeSettings["reference"]>) => setS((x) => ({ ...x, reference: { ...x.reference, ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.themes.save({ id: theme.id, name, category, settings: s as unknown as Record<string, unknown> });
      await qc.invalidateQueries({ queryKey: THEMES_KEY });
      await useLive.getState().refreshThemes();
      toast.success("Theme saved");
    } catch (e) {
      toast.error("The theme could not be saved", e);
    } finally {
      setSaving(false);
    }
  };

  const defaults: { key: string; label: string }[] = [
    { key: "presentation.defaultSongThemeId", label: "Songs" },
    { key: "presentation.defaultScriptureThemeId", label: "Scripture" },
    { key: "presentation.defaultAnnouncementThemeId", label: "Announcements" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-64 font-semibold" aria-label="Theme name" />
        <Select value={category} onChange={(e) => setCategory(e.target.value as ThemeCategory)} className="w-44" aria-label="Theme category">
          <option value="general">General</option>
          <option value="song">Songs</option>
          <option value="scripture">Scripture</option>
          <option value="announcement">Announcements</option>
        </Select>
        <span className="ml-2 text-xs text-subtle">Default for:</span>
        {defaults.map((d) => {
          const isDefault = setting(settings.data, d.key, "") === theme.id;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => !isDefault && updateSettings.mutate({ [d.key]: theme.id })}
              className={cn("rounded-md border px-2 py-0.5 text-xs", isDefault ? "border-primary bg-primary/15" : "border-border text-muted hover:text-text")}
            >
              {d.label}
            </button>
          );
        })}
        <div className="ml-auto flex gap-1.5">
          <IconButton
            label="Duplicate"
            icon={<Copy className="size-4" />}
            onClick={async () => {
              try {
                const copy = await api.themes.duplicate(theme.id, null);
                await qc.invalidateQueries({ queryKey: THEMES_KEY });
                onDuplicated(copy.id);
              } catch (e) {
                toast.error("Could not duplicate", e);
              }
            }}
          />
          {!theme.isBuiltin && (
            <IconButton
              label="Delete"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!(await confirm({ title: `Delete “${theme.name}”?`, message: "Items using this theme will use the default theme instead.", confirmLabel: "Delete", danger: true }))) return;
                try {
                  await api.themes.remove(theme.id);
                  await qc.invalidateQueries({ queryKey: THEMES_KEY });
                  onDeleted();
                } catch (e) {
                  toast.error("Could not delete the theme", e);
                }
              }}
            />
          )}
          <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || !name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[400px] shrink-0 space-y-5 overflow-y-auto border-r border-border p-4">
          <Group title="Text">
            <Field label="Font">
              <Select value={s.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
                {[...new Set([s.fontFamily, ...FONT_CHOICES])].map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {fontLabel(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Size" value={s.fontSize} min={16} max={240} onChange={(v) => set("fontSize", v)} />
              <Field label="Weight">
                <Select value={s.fontWeight} onChange={(e) => set("fontWeight", Number(e.target.value))}>
                  {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
              <ColorField label="Colour" value={s.textColor} onChange={(v) => set("textColor", v)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Horizontal">
                <Select value={s.textAlign} onChange={(e) => set("textAlign", e.target.value as ThemeSettings["textAlign"])}>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
              <Field label="Vertical">
                <Select value={s.verticalAlign} onChange={(e) => set("verticalAlign", e.target.value as ThemeSettings["verticalAlign"])}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
              </Field>
              <NumberField label="Line height" step={0.05} value={s.lineHeight} min={0.9} max={2.5} onChange={(v) => set("lineHeight", v)} />
              <NumberField label="Safe margin (%)" value={s.safeMargin} min={0} max={20} onChange={(v) => set("safeMargin", v)} />
              <NumberField label="Text width (%)" step={5} value={s.textWidth} min={30} max={100} onChange={(v) => set("textWidth", v)} />
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox checked={s.textShadow} onChange={(v) => set("textShadow", v)} label="Shadow" />
              <Checkbox checked={s.textOutline} onChange={(v) => set("textOutline", v)} label="Outline" />
              <Checkbox checked={s.italic} onChange={(v) => set("italic", v)} label="Italic" />
            </div>
            <Field label="Letter case">
              <Select value={s.textTransform} onChange={(e) => set("textTransform", e.target.value as TextCase)}>
                {TEXT_CASES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </Group>

          <Group title="Background">
            <Field label="Type">
              <Select value={s.background.type} onChange={(e) => setBg({ type: e.target.value as ThemeSettings["background"]["type"] })}>
                <option value="black">Black</option>
                <option value="color">Solid colour</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
              </Select>
            </Field>
            {(s.background.type === "black" || s.background.type === "color") && (
              <Field label="Style">
                <Select value={s.background.style} onChange={(e) => setBg({ style: e.target.value as BackgroundStyle })}>
                  {BACKGROUND_STYLES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {s.background.type !== "black" && <ColorField label={s.background.type === "color" ? "Colour" : "Colour behind media"} value={s.background.color} onChange={(v) => setBg({ color: v })} />}
            {(s.background.type === "image" || s.background.type === "video") && (
              <>
                <div className="flex gap-2">
                  <Button icon={<ImagePlus className="size-4" />} onClick={() => setPicking("background")}>
                    {s.background.mediaId ? "Change media" : "Choose media"}
                  </Button>
                  {s.background.mediaId && !media.data?.[s.background.mediaId] && <span className="self-center text-xs text-warning">Media missing</span>}
                </div>
                <Field label="Fit">
                  <Select value={s.background.fit} onChange={(e) => setBg({ fit: e.target.value as ThemeSettings["background"]["fit"] })}>
                    <option value="cover">Fill the screen</option>
                    <option value="contain">Show all</option>
                    <option value="stretch">Stretch</option>
                  </Select>
                </Field>
                {s.background.type === "video" && (
                  <div className="flex gap-4">
                    <Checkbox checked={s.background.videoLoop} onChange={(v) => setBg({ videoLoop: v })} label="Loop" />
                    <Checkbox checked={s.background.videoMuted} onChange={(v) => setBg({ videoMuted: v })} label="Muted" />
                  </div>
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <ColorField label="Overlay colour" value={s.background.overlayColor} onChange={(v) => setBg({ overlayColor: v })} />
              <NumberField label="Overlay opacity (%)" value={Math.round(s.background.overlayOpacity * 100)} min={0} max={100} onChange={(v) => setBg({ overlayOpacity: v / 100 })} />
            </div>
          </Group>

          <Group title="Scripture">
            <div className="flex flex-wrap gap-4">
              <Checkbox checked={s.reference.show} onChange={(v) => setRef({ show: v })} label="Show reference" />
              <Checkbox checked={s.reference.showTranslation} onChange={(v) => setRef({ showTranslation: v })} label="Show translation" />
              <Checkbox checked={s.verseNumbers.show} onChange={(v) => set("verseNumbers", { show: v })} label="Verse numbers" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Reference">
                <Select value={s.reference.position} onChange={(e) => setRef({ position: e.target.value as "top" | "bottom" })}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </Select>
              </Field>
              <NumberField label="Size" value={s.reference.fontSize} min={12} max={160} onChange={(v) => setRef({ fontSize: v })} />
              <ColorField label="Colour" value={s.reference.color} onChange={(v) => setRef({ color: v })} />
            </div>
          </Group>

          <Group title="Song footer and logo">
            <Checkbox checked={s.footer.showSongInfo} onChange={(v) => set("footer", { ...s.footer, showSongInfo: v })} label="Show song title and copyright on the last slide area" />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Footer size" value={s.footer.fontSize} min={10} max={80} onChange={(v) => set("footer", { ...s.footer, fontSize: v })} />
              <ColorField label="Footer colour" value={s.footer.color} onChange={(v) => set("footer", { ...s.footer, color: v })} />
            </div>
            <Checkbox checked={s.logo.show} onChange={(v) => set("logo", { ...s.logo, show: v })} label="Show a logo in the corner" />
            {s.logo.show && (
              <div className="grid grid-cols-2 gap-2">
                <Button className="col-span-2" icon={<ImagePlus className="size-4" />} onClick={() => setPicking("logo")}>
                  {s.logo.mediaId ? "Change logo" : "Choose logo"}
                </Button>
                <Field label="Corner">
                  <Select value={s.logo.position} onChange={(e) => set("logo", { ...s.logo, position: e.target.value as ThemeSettings["logo"]["position"] })}>
                    <option value="top-left">Top left</option>
                    <option value="top-right">Top right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                  </Select>
                </Field>
                <NumberField label="Width (%)" value={s.logo.size} min={2} max={40} onChange={(v) => set("logo", { ...s.logo, size: v })} />
              </div>
            )}
          </Group>

          <Group title="Transition">
            <TransitionPicker
              value={s.transition.type}
              onChange={(type) => {
                set("transition", { ...s.transition, type });
                play(type);
              }}
              onPreview={play}
            />
            <div className="grid grid-cols-2 items-end gap-2">
              <NumberField label="Duration (ms)" value={s.transition.durationMs} min={0} max={3000} step={50} onChange={(v) => set("transition", { ...s.transition, durationMs: v })} />
              <Button icon={<Play className="size-4" />} disabled={s.transition.type === "none" || s.transition.durationMs <= 0} onClick={() => play(s.transition.type)}>
                Play transition
              </Button>
            </div>
          </Group>
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="mb-3 flex gap-1">
            {(["lyrics", "scripture", "announcement"] as const).map((x) => (
              <button key={x} type="button" onClick={() => setSample(x)} className={cn("rounded-md px-3 py-1 text-sm capitalize", sample === x ? "bg-elevated" : "text-muted hover:text-text")}>
                {x}
              </button>
            ))}
          </div>
          <div role="region" aria-label="Preview" className="relative w-full max-w-5xl overflow-hidden rounded-md border border-border" style={{ aspectRatio: 16 / 9 }}>
            <SlideRenderer
              content={content}
              slideKey={`${sample}-${second ? 2 : 1}`}
              theme={previewTheme}
              output="normal"
              media={media.data ?? {}}
              logo={null}
              aspect={16 / 9}
              animate={!!playing}
              className="absolute inset-0 overflow-hidden"
            />
          </div>
          <p className="mt-2 text-xs text-subtle">Preview at 16:9. Text shrinks automatically to stay inside the safe margin. Point at a transition to see it play.</p>
        </div>
      </div>

      <MediaPickerDialog
        open={picking !== null}
        kind={picking === "logo" ? "image" : s.background.type === "video" ? "video" : "image"}
        title={picking === "logo" ? "Choose a logo" : "Choose a background"}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          if (picking === "logo") set("logo", { ...s.logo, mediaId: m.id });
          else setBg({ mediaId: m.id, type: m.kind === "video" ? "video" : "image" });
          setPicking(null);
        }}
      />
    </div>
  );
}

/**
 * The transition effects as tiles. Pointing at one (or moving to it with the
 * keyboard) plays it in the preview; clicking chooses it.
 */
function TransitionPicker({ value, onChange, onPreview }: { value: TransitionType; onChange: (t: TransitionType) => void; onPreview: (t: TransitionType) => void }) {
  const [hovered, setHovered] = useState<TransitionType | null>(null);
  const [demo, setDemo] = useState(0);
  const hoverTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const point = (t: TransitionType) => {
    setHovered(t);
    setDemo((n) => n + 1);
    // A short pause, so sweeping across the tiles does not flicker the preview.
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => onPreview(t), 140);
  };
  const leave = () => {
    setHovered(null);
    window.clearTimeout(hoverTimer.current);
  };
  return (
    <div role="radiogroup" aria-label="Effect" className="grid grid-cols-3 gap-1.5" onMouseLeave={leave}>
      {TRANSITIONS.map((t) => {
        const active = t.value === value;
        const animating = hovered === t.value && t.value !== "none";
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.value)}
            onMouseEnter={() => point(t.value)}
            onFocus={() => point(t.value)}
            onBlur={leave}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition",
              active ? "border-primary bg-primary/10 text-text ring-1 ring-primary/40" : "border-border bg-panel text-muted hover:border-primary/60 hover:text-text",
            )}
          >
            <span aria-hidden className="flex h-7 w-12 items-center justify-center overflow-hidden rounded bg-[#1d1813] text-[11px] font-bold text-[#f0d890]">
              <span key={animating ? demo : "still"} style={animating ? { animation: `sf-${t.value}-in 700ms ease-in-out both` } : undefined}>
                Aa
              </span>
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <TextField
      label={label}
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
    />
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-10 cursor-pointer rounded border border-border bg-bg p-0.5" />
        <Input value={value} onChange={(e) => /^#[0-9a-f]{0,8}$/i.test(e.target.value) && onChange(e.target.value.toUpperCase())} className="font-mono text-xs" />
      </div>
    </Field>
  );
}
