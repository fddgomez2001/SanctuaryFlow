import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, ImagePlus, X } from "lucide-react";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Select, Switch } from "@/components/ui/Field";
import { Section } from "@/components/ui/misc";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useMediaRefs, useRenderTheme } from "@/hooks/useThemes";
import { LOGO_KEYS, logoBackground, logoScreenMediaIds, logoScreenSettings, type LogoBackgroundSetting, type LogoBackgroundType } from "@/lib/logo-screen";
import { MediaPickerDialog } from "@/features/services/pickers";
import { ColorField, NumberField } from "@/features/themes/ThemesPage";

const BACKGROUNDS: { value: LogoBackgroundType; label: string }[] = [
  { value: "theme", label: "The current theme background" },
  { value: "black", label: "Black" },
  { value: "color", label: "A colour" },
  { value: "image", label: "A picture" },
  { value: "video", label: "A video (loops, no sound)" },
];

/** What the Logo button shows: a logo picture or video over a chosen background. */
export function LogoScreenSettings() {
  const s = useSettings();
  const u = useUpdateSettings();
  const screen = logoScreenSettings(s.data);
  const { theme, media: themeMedia } = useRenderTheme(null, "song");
  const refs = useMediaRefs(logoScreenMediaIds(screen));
  const [picking, setPicking] = useState<null | "logo" | "background">(null);
  const ids = logoScreenMediaIds(screen);
  const assets = useQuery({
    queryKey: ["media-titles", ids],
    queryFn: async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await api.media.get(id).catch(() => null)] as const))),
    enabled: ids.length > 0,
  });
  const logo = screen.logoMediaId ? (refs.data?.[screen.logoMediaId] ?? null) : null;
  const logoAsset = screen.logoMediaId ? assets.data?.[screen.logoMediaId] : null;
  const bgAsset = screen.background.mediaId ? assets.data?.[screen.background.mediaId] : null;
  const setBackground = (patch: Partial<LogoBackgroundSetting>) => u.mutate({ [LOGO_KEYS.background]: { ...screen.background, ...patch } });
  const isVideo = logo?.kind === "video" || logoAsset?.kind === "video";

  return (
    <Section title="Logo screen" description="What the Logo button (L) shows, for example before the service or between parts of it.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Field label="Logo" hint="A picture is shown in the middle; a video fills the screen and loops. Without a logo the church name is shown.">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                {isVideo && <Film className="size-4 text-subtle" />}
                <span className="truncate">{screen.logoMediaId ? (logoAsset?.title ?? "Logo") : "None — the church name is shown"}</span>
              </span>
              <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking("logo")}>
                Choose picture or video…
              </Button>
              {screen.logoMediaId && <IconButton size="sm" label="Remove logo" icon={<X className="size-3.5" />} onClick={() => u.mutate({ [LOGO_KEYS.media]: null })} />}
            </div>
          </Field>
          {isVideo ? (
            <Switch checked={screen.sound} onChange={(v) => u.mutate({ [LOGO_KEYS.sound]: v })} label="Play the video's sound" description="Off by default, so a logo loop stays silent." />
          ) : (
            screen.logoMediaId && <NumberField label="Logo size (% of the screen height)" value={screen.size} min={10} max={90} step={5} onChange={(v) => u.mutate({ [LOGO_KEYS.size]: v })} />
          )}
          <Field label="Background">
            <Select value={screen.background.type} onChange={(e) => setBackground({ type: e.target.value as LogoBackgroundType })}>
              {BACKGROUNDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          {screen.background.type === "color" && <ColorField label="Background colour" value={screen.background.color} onChange={(color) => setBackground({ color })} />}
          {(screen.background.type === "image" || screen.background.type === "video") && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm">{bgAsset?.title ?? `No ${screen.background.type === "image" ? "picture" : "video"} chosen yet`}</span>
              <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicking("background")}>
                Choose {screen.background.type === "image" ? "picture" : "video"}…
              </Button>
            </div>
          )}
        </div>
        <div>
          <p className="field-label">Preview</p>
          <div className="relative overflow-hidden rounded-md border border-border" style={{ aspectRatio: 16 / 9 }}>
            <SlideRenderer
              content={null}
              slideKey={null}
              theme={theme}
              output="logo"
              media={{ ...themeMedia, ...(refs.data ?? {}) }}
              logo={logo}
              logoScreen={{ logo, background: logoBackground(screen.background), size: screen.size, sound: false }}
              churchName={setting(s.data, "general.churchName", "")}
              aspect={16 / 9}
              className="absolute inset-0 overflow-hidden"
            />
          </div>
          <p className="mt-1 text-xs text-subtle">Videos play on the output; the preview shows a still.</p>
        </div>
      </div>
      <MediaPickerDialog
        open={picking !== null}
        kind={picking === "logo" ? ["image", "video"] : screen.background.type === "video" ? "video" : "image"}
        title={picking === "logo" ? "Choose a logo picture or video" : "Choose a background"}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          if (picking === "logo") u.mutate({ [LOGO_KEYS.media]: m.id });
          else setBackground({ mediaId: m.id });
          setPicking(null);
        }}
      />
    </Section>
  );
}
