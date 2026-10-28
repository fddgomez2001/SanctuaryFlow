import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Film, ImagePlus } from "lucide-react";
import { create } from "zustand";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Switch } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { useMediaRefs, useThemes } from "@/hooks/useThemes";
import {
  BACKGROUND_STYLES,
  FONT_CHOICES,
  fontLabel,
  TEXT_CASES,
  themeMediaIds,
  TRANSITIONS,
  type BackgroundStyle,
  type BackgroundType,
  type TextAlign,
  type TextCase,
  type ThemeSettings,
  type TransitionType,
  type VerticalAlign,
} from "@/lib/theme";
import { buildRenderState, itemTheme, useLive } from "@/services/presentation-engine/store";
import { MediaPickerDialog } from "@/features/services/pickers";
import { ColorField } from "@/features/themes/ThemesPage";
import { lookBase, saveItemLook, type LookScope } from "./itemLook";

/** Which lineup item the Customize editor is open for. */
export const useThemeEditor = create<{ itemId: string | null; open: (itemId: string) => void; close: () => void }>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <Field label={`${label}: ${value}${unit}`}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
    </Field>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((o) =>
          o.icon ? (
            <IconButton key={o.value} label={o.label} icon={o.icon} active={value === o.value} variant="secondary" onClick={() => onChange(o.value)} />
          ) : (
            <Button key={o.value} size="sm" variant={value === o.value ? "primary" : "secondary"} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
              {o.label}
            </Button>
          ),
        )}
      </div>
    </Field>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

const BACKGROUNDS: { value: BackgroundType; label: string }[] = [
  { value: "video", label: "Video (loops)" },
  { value: "image", label: "Picture" },
  { value: "color", label: "Colour" },
  { value: "black", label: "Black" },
];

/**
 * Restyles one lineup item (words, background and transition) with a live
 * preview, then saves the look for that item, into its theme, or as a new
 * theme. The output changes with the chosen transition.
 */
export function QuickThemeEditor() {
  const itemId = useThemeEditor((s) => s.itemId);
  const close = useThemeEditor((s) => s.close);
  const live = useLive();
  const themes = useThemes();
  const item = live.engine.items.find((i) => i.id === itemId) ?? null;
  const start = useMemo(() => (item ? itemTheme(live, item.themeId) : null), [item, live]);
  const [draft, setDraft] = useState<ThemeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const refs = useMediaRefs(draft ? themeMediaIds(draft) : []);

  useEffect(() => {
    setDraft(start ? structuredClone(start) : null);
    setNaming(null);
    // Start again only when another item is opened.
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item || !draft) return null;
  const set = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setBg = (patch: Partial<ThemeSettings["background"]>) => setDraft((d) => (d ? { ...d, background: { ...d.background, ...patch } } : d));
  const liveIndex = live.engine.live && live.engine.items[live.engine.live.itemIndex]?.id === item.id ? live.engine.live.slideIndex : 0;
  const slide = item.slides[liveIndex] ?? item.slides[0] ?? null;
  const aspect = buildRenderState(live).aspect;
  const { record, ownForItem } = lookBase(item, themes.data ?? []);
  const canUpdateBase = !!record && !record.isBuiltin && !ownForItem;
  const bg = draft.background;

  const save = async (target: LookScope) => {
    setSaving(true);
    try {
      const saved = await saveItemLook(item, draft, target);
      toast.success(
        target.scope === "theme" ? `The “${saved.name}” theme was updated` : target.scope === "new" ? `Theme “${saved.name}” was saved and used for “${item.title}”` : `“${item.title}” has its new look`,
      );
      close();
    } catch (e) {
      toast.error("The look could not be saved", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && close()}
      size="xl"
      title={`Customize “${item.title}”`}
      description={`Starting from the “${record?.name ?? "default"}” theme. The output changes when you save.`}
      footer={
        naming !== null ? (
          <>
            <Input aria-label="New theme name" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Enter" && naming.trim() && void save({ scope: "new", name: naming })} className="max-w-72" autoFocus />
            <Button variant="ghost" onClick={() => setNaming(null)} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void save({ scope: "new", name: naming })} loading={saving} disabled={!naming.trim()}>
              Save theme
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            {canUpdateBase && (
              <Button onClick={() => void save({ scope: "theme" })} loading={saving} title="Every item that uses this theme changes">
                Save to theme “{record!.name}”
              </Button>
            )}
            <Button onClick={() => setNaming(`${item.title} theme`)} disabled={saving} title="Keep this look as a theme you can use for other songs too">
              Save as new theme…
            </Button>
            <Button variant="primary" onClick={() => void save({ scope: "item" })} loading={saving}>
              Save for this item
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:sticky lg:top-0 lg:self-start">
          <div className="relative overflow-hidden rounded-md border border-border" style={{ aspectRatio: aspect }}>
            <SlideRenderer
              content={slide?.content ?? null}
              slideKey={slide?.id ?? null}
              theme={draft}
              output="normal"
              media={{ ...live.media, ...(refs.data ?? {}) }}
              logo={null}
              aspect={aspect}
              className="absolute inset-0 overflow-hidden"
            />
          </div>
          <p className="mt-1 text-xs text-subtle">Videos play on the output; the preview shows a still.</p>
          {live.themeOverrideId && (
            <p className="mt-2 text-xs text-warning">The Theme menu at the top is set for the whole output, so this look shows once it is back on “as planned”.</p>
          )}
        </div>
        <div className="space-y-3">
          <Group title="Words">
            <Field label="Font">
              <Select value={draft.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} style={{ fontFamily: draft.fontFamily }}>
                {[...new Set([draft.fontFamily, ...FONT_CHOICES])].map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {fontLabel(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Slider label="Text size" value={draft.fontSize} min={24} max={200} step={2} unit="px" onChange={(v) => set("fontSize", v)} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Switch checked={draft.fontWeight >= 600} onChange={(v) => set("fontWeight", v ? 700 : 400)} label="Bold" />
              <Switch checked={draft.italic} onChange={(v) => set("italic", v)} label="Italic" />
              <Switch checked={draft.textShadow} onChange={(v) => set("textShadow", v)} label="Shadow" />
              <Switch checked={draft.textOutline} onChange={(v) => set("textOutline", v)} label="Outline" />
            </div>
            <Segmented<TextCase> label="Letter case" value={draft.textTransform} onChange={(v) => set("textTransform", v)} options={TEXT_CASES} />
            <ColorField label="Text colour" value={draft.textColor} onChange={(v) => set("textColor", v)} />
            <Slider label="Text width" value={draft.textWidth} min={30} max={100} step={5} unit="%" onChange={(v) => set("textWidth", v)} />
            <Slider label="Line spacing" value={draft.lineHeight} min={0.9} max={2} step={0.05} unit="×" onChange={(v) => set("lineHeight", Math.round(v * 100) / 100)} />
            <Segmented<TextAlign>
              label="Align"
              value={draft.textAlign}
              onChange={(v) => set("textAlign", v)}
              options={[
                { value: "left", label: "Align left", icon: <AlignLeft className="size-4" /> },
                { value: "center", label: "Centre", icon: <AlignCenter className="size-4" /> },
                { value: "right", label: "Align right", icon: <AlignRight className="size-4" /> },
              ]}
            />
            <Segmented<VerticalAlign>
              label="Position"
              value={draft.verticalAlign}
              onChange={(v) => set("verticalAlign", v)}
              options={[
                { value: "top", label: "Top" },
                { value: "middle", label: "Middle" },
                { value: "bottom", label: "Bottom" },
              ]}
            />
          </Group>

          <Group title="Background">
            <Field label="Background">
              <Select value={bg.type} onChange={(e) => setBg({ type: e.target.value as BackgroundType })}>
                {BACKGROUNDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </Field>
            {(bg.type === "video" || bg.type === "image") && (
              <Button size="sm" icon={bg.type === "video" ? <Film className="size-3.5" /> : <ImagePlus className="size-3.5" />} onClick={() => setPicking(true)}>
                {bg.mediaId ? "Change" : "Choose"} {bg.type === "video" ? "video" : "picture"}…
              </Button>
            )}
            {(bg.type === "black" || bg.type === "color") && (
              <Field label="Style">
                <Select value={bg.style} onChange={(e) => setBg({ style: e.target.value as BackgroundStyle })}>
                  {BACKGROUND_STYLES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {bg.type !== "black" && <ColorField label={bg.type === "color" ? "Colour" : "Colour behind it"} value={bg.color} onChange={(v) => setBg({ color: v })} />}
            {(bg.type === "video" || bg.type === "image") && (
              <Slider
                label="Darken"
                value={Math.round(bg.overlayOpacity * 100)}
                min={0}
                max={80}
                step={5}
                unit="%"
                onChange={(v) => setBg({ overlayColor: "#000000", overlayOpacity: v / 100 })}
              />
            )}
          </Group>

          <Group title="Transition">
            <Field label="Effect">
              <Select value={draft.transition.type} onChange={(e) => set("transition", { type: e.target.value as TransitionType, durationMs: draft.transition.durationMs || 400 })}>
                {TRANSITIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.transition.type !== "none" && (
              <Slider
                label="Transition time"
                value={Math.round(draft.transition.durationMs / 100) / 10}
                min={0.1}
                max={3}
                step={0.1}
                unit=" s"
                onChange={(v) => set("transition", { ...draft.transition, durationMs: Math.round(v * 1000) })}
              />
            )}
          </Group>
        </div>
      </div>
      <MediaPickerDialog
        open={picking}
        kind={bg.type === "video" ? "video" : "image"}
        title={bg.type === "video" ? "Choose a background video" : "Choose a background picture"}
        onClose={() => setPicking(false)}
        onPick={(m) => {
          setBg({ mediaId: m.id, type: m.kind === "video" ? "video" : "image", fit: "cover", videoLoop: true, videoMuted: true });
          setPicking(false);
        }}
      />
    </Dialog>
  );
}
