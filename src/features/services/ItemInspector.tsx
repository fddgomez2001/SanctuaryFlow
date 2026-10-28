import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Globe, Pencil } from "lucide-react";
import type { ServiceItemInput } from "@/types/generated/ServiceItemInput";
import { api } from "@/services/api";
import { navigate } from "@/app/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { LoadingBlock } from "@/components/ui/misc";
import { SlideThumb } from "@/components/slide/SlideThumb";
import { useSettings } from "@/hooks/useSettings";
import { useThemes } from "@/hooks/useThemes";
import { canvaPagesOf, ITEM_KIND_LABELS, itemKind, mediaSettings, scriptureSettings, withCanvaLink } from "@/lib/service-items";
import { parseCanvaLink } from "@/lib/canva";
import { canonBook } from "@/lib/bible/canon";
import { formatReference } from "@/lib/bible/reference";
import { DEFAULT_THEME, normalizeTheme } from "@/lib/theme";
import { loadThemes, resolveItems } from "@/services/presentation-engine/resolve";
import { ScripturePickerDialog } from "./pickers";
import { CanvaPageCount, CanvaPagesDialog, canvaLinkOf, withCanvaPages } from "./CanvaPagesFlow";

export function ItemInspector({ item, planThemeId, onChange }: { item: ServiceItemInput; planThemeId: string | null; onChange: (patch: Partial<ServiceItemInput>) => void }) {
  const themes = useThemes();
  const settings = useSettings();
  const s = (item.settings ?? {}) as Record<string, unknown>;
  const setSetting = (key: string, value: unknown) => onChange({ settings: { ...s, [key]: value } });
  const [editingPassage, setEditingPassage] = useState(false);
  const [canvaPages, setCanvaPages] = useState(false);
  const canva = canvaLinkOf(s);

  const preview = useQuery({
    queryKey: ["item-preview", item, planThemeId, settings.dataUpdatedAt, themes.dataUpdatedAt],
    queryFn: async () => {
      const themeMap = await loadThemes();
      const { items, media } = await resolveItems([{ ...item, id: item.id ?? "preview", settings: item.settings ?? {} }], {
        settings: settings.data,
        planThemeId,
        themes: themeMap,
      });
      return { item: items[0]!, media, themes: themeMap };
    },
    placeholderData: (p) => p,
  });

  const resolved = preview.data?.item;
  const theme = (resolved?.themeId && preview.data?.themes.get(resolved.themeId)) || DEFAULT_THEME;
  const sc = scriptureSettings(s);
  const media = mediaSettings(s);
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations, enabled: item.itemType === "scripture" });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border p-4">
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">{ITEM_KIND_LABELS[itemKind(item)]}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Title in the service order">
            <Input value={item.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          {item.itemType !== "heading" && (
            <Field label="Theme" hint="Overrides the service and default themes for this item.">
              <Select value={typeof s.themeId === "string" ? s.themeId : ""} onChange={(e) => setSetting("themeId", e.target.value || null)}>
                <option value="">Use default</option>
                {themes.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {item.itemType === "song" && item.refId && (
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => void navigate("songs", { songId: item.refId! })}>
            Open song in the library
          </Button>
        )}

        {item.itemType === "scripture" && (
          <div className="grid gap-3 md:grid-cols-[1fr_200px_160px]">
            <Field label="Passage">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={sc.references.map((r) => formatReference(canonBook(r.bookId)?.name ?? r.bookId, r)).join("; ") || "None"}
                />
                <Button onClick={() => setEditingPassage(true)}>Change</Button>
              </div>
            </Field>
            <Field label="Translation">
              <Select value={sc.translationId ?? ""} onChange={(e) => setSetting("translationId", e.target.value || null)}>
                <option value="">Default translation</option>
                {translations.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Slides">
              <Select value={sc.split ?? ""} onChange={(e) => setSetting("split", e.target.value || undefined)}>
                <option value="">Default</option>
                <option value="fit">Fit verses together</option>
                <option value="verse">One verse per slide</option>
              </Select>
            </Field>
          </div>
        )}

        {(item.itemType === "announcement" || item.itemType === "sermon" || item.itemType === "custom") &&
          ("canvaUrl" in s ? (
            <div className="space-y-2">
              <CanvaLinkField key={String(s.canvaUrl)} url={String(s.canvaUrl ?? "")} onChange={(url) => onChange({ settings: withCanvaLink(s, url) })} />
              <CanvaPageCount value={canvaPagesOf(s)} onChange={(n) => setSetting("canvaPages", n)} />
              <Button size="sm" variant="primary" icon={<Globe className="size-3.5" />} onClick={() => setCanvaPages(true)}>
                Show every page as a slide…
              </Button>
            </div>
          ) : item.refId && typeof s.canvaSource === "string" ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Globe className="size-3.5" />} onClick={() => setCanvaPages(true)}>
                Update pages from Canva…
              </Button>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => void navigate("slides", { deckId: item.refId! })}>
                Edit these slides in the Slide Editor
              </Button>
            </div>
          ) : item.refId ? (
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => void navigate("slides", { deckId: item.refId! })}>
              Edit these slides in the Slide Editor
            </Button>
          ) : (
            <Field label="Text" hint="Put a line with only --- between slides.">
              <Textarea rows={6} value={typeof s.text === "string" ? s.text : ""} onChange={(e) => setSetting("text", e.target.value)} />
            </Field>
          ))}

        {(item.itemType === "image" || item.itemType === "video") && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Fit">
              <Select value={media.fit} onChange={(e) => setSetting("fit", e.target.value)} className="w-40">
                <option value="cover">Fill the screen</option>
                <option value="contain">Show all (letterbox)</option>
                <option value="stretch">Stretch</option>
              </Select>
            </Field>
            {item.itemType === "video" && (
              <>
                <Checkbox checked={media.loop} onChange={(v) => setSetting("loop", v)} label="Loop" />
                <Checkbox checked={media.muted} onChange={(v) => setSetting("muted", v)} label="Mute sound" />
              </>
            )}
          </div>
        )}

        {item.itemType === "blank" && (
          <Field label="Show">
            <Select value={s.mode === "black" ? "black" : "theme"} onChange={(e) => setSetting("mode", e.target.value)} className="w-60">
              <option value="theme">Theme background only</option>
              <option value="black">Black screen</option>
            </Select>
          </Field>
        )}

        {item.itemType !== "heading" && (
          <Field label="Operator notes" hint="Only visible on the operator screen.">
            <Input value={item.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || null })} />
          </Field>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {item.itemType === "heading" ? (
          <p className="text-sm text-muted">Section headings organize the service order and are skipped during the presentation.</p>
        ) : preview.isLoading ? (
          <LoadingBlock label="Preparing slides…" />
        ) : (
          <>
            {resolved?.error && (
              <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" /> {resolved.error}
              </p>
            )}
            <p className="mb-2 text-xs text-subtle">{resolved ? `${resolved.slides.length} slide${resolved.slides.length === 1 ? "" : "s"}` : ""}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {resolved?.slides.map((slide, i) => (
                <SlideThumb key={slide.id} slide={slide} theme={normalizeTheme(theme)} media={preview.data?.media ?? {}} index={i} />
              ))}
            </div>
          </>
        )}
      </div>

      {canva && (
        <CanvaPagesDialog
          open={canvaPages}
          onClose={() => setCanvaPages(false)}
          title={item.title}
          link={canva.link}
          update={canva.brought}
          onImported={(deck) => {
            setCanvaPages(false);
            const next = withCanvaPages({ refId: item.refId, settings: s }, deck.id, canva.link);
            onChange({ refId: next.refId, settings: next.settings });
          }}
        />
      )}
      <ScripturePickerDialog
        open={editingPassage}
        initial={{
          translationId: sc.translationId ?? null,
          text: sc.references.map((r) => formatReference(canonBook(r.bookId)?.name ?? r.bookId, r)).join("; "),
        }}
        onClose={() => setEditingPassage(false)}
        onPick={(p) => {
          onChange({ title: p.title, settings: { ...s, translationId: p.translationId, references: p.references } });
          setEditingPassage(false);
        }}
      />
    </div>
  );
}

/** Edits a Canva item's link; the item keeps its last valid link until a new one is accepted. */
function CanvaLinkField({ url, onChange }: { url: string; onChange: (embedUrl: string) => void }) {
  const [text, setText] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (text.trim() === url) return;
    const parsed = parseCanvaLink(text);
    if (parsed.ok) {
      setError(null);
      onChange(parsed.embedUrl);
    } else {
      setError(parsed.error);
    }
  };
  return (
    <Field label="Canva link" hint="Shown live from Canva, so it needs the internet during the service." error={error ?? undefined}>
      <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
    </Field>
  );
}
