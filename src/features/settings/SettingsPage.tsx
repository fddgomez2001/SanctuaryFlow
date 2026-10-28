import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, Keyboard, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { api } from "@/services/api";
import { navigate } from "@/app/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Select, Switch, TextField } from "@/components/ui/Field";
import { Kbd, PageHeader, Section } from "@/components/ui/misc";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useThemes } from "@/hooks/useThemes";
import { comboLabel, DEFAULT_SHORTCUTS, eventToCombo, findConflicts, normalizeShortcuts, SHORTCUT_ACTIONS, SHORTCUT_LABELS, type ShortcutAction } from "@/lib/keyboard";
import { formatBytes } from "@/lib/format";
import { outputFadeMs, OUTPUT_FADE_KEY } from "@/lib/logo-screen";
import { LogoScreenSettings } from "./LogoScreenSettings";
import { useLive } from "@/services/presentation-engine/store";
import { NumberField } from "@/features/themes/ThemesPage";
import { cn } from "@/lib/cn";
import { GREETING_ENABLED, USER_NAME } from "@/lib/greeting";
import { WELCOME_DONE } from "@/features/welcome/Welcome";

type Tab = "general" | "presentation" | "library" | "keyboard";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" description="Saved on this computer." />
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 space-y-0.5 border-r border-border p-2">
          {(
            [
              ["general", "General"],
              ["presentation", "Presentation"],
              ["library", "Library"],
              ["keyboard", "Keyboard"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("block w-full rounded-md px-3 py-2 text-left text-sm", tab === id ? "bg-elevated" : "text-muted hover:text-text")}>
              {label}
            </button>
          ))}
          <div className="my-2 border-t border-border" />
          <button type="button" onClick={() => void navigate("sync")} className="block w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:text-text">
            Synchronization →
          </button>
          <button type="button" onClick={() => void navigate("backup")} className="block w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:text-text">
            Backup →
          </button>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 p-6">
            {tab === "general" && <General />}
            {tab === "presentation" && <Presentation />}
            {tab === "library" && <Library />}
            {tab === "keyboard" && <KeyboardSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

function General() {
  const s = useSettings();
  const u = useUpdateSettings();
  const [name, setName] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  return (
    <Section title="General">
      <div className="space-y-4">
        <TextField
          label="Your name"
          value={userName ?? setting(s.data, USER_NAME, "")}
          onChange={(e) => setUserName(e.target.value)}
          onBlur={() => userName !== null && u.mutate({ [USER_NAME]: userName.trim() })}
          maxLength={60}
          hint="The greeting and the Home page welcome you by this name."
        />
        <TextField
          label="Church name"
          value={name ?? setting(s.data, "general.churchName", "")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== null && u.mutate({ "general.churchName": name.trim() })}
          hint="Shown on the holding screen when no logo is set."
        />
        <Field label="Default language for new songs">
          <Select value={setting(s.data, "general.defaultLanguage", "en")} onChange={(e) => u.mutate({ "general.defaultLanguage": e.target.value })} className="w-60">
            <option value="en">English</option>
            <option value="tl">Filipino / Tagalog</option>
            <option value="ceb">Cebuano</option>
            <option value="es">Spanish</option>
          </Select>
        </Field>
        <Switch
          checked={setting(s.data, "general.reopenLastService", true)}
          onChange={(v) => u.mutate({ "general.reopenLastService": v })}
          label="Restore the last presentation after a restart"
          description="If the computer restarts during a service, the same service and slide are ready again."
        />
        <Switch
          checked={setting(s.data, GREETING_ENABLED, true)}
          onChange={(v) => u.mutate({ [GREETING_ENABLED]: v })}
          label="Greet me with a Bible verse when SanctuaryFlow opens"
          description="Once each morning (until noon), afternoon (until 6 pm) and evening, with a verse from your default Bible translation."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Sparkles className="size-4" />} onClick={() => u.mutate({ [WELCOME_DONE]: false })}>
            Show the welcome tour again
          </Button>
          <span className="text-xs text-subtle">The walkthrough shown on the first start: your name and what SanctuaryFlow can do.</span>
        </div>
        <Field label="Interface theme" hint="The look of the operator console. The projector output always uses presentation themes.">
          <Select value={setting(s.data, "general.uiTheme", "light")} onChange={(e) => u.mutate({ "general.uiTheme": e.target.value })} className="w-60">
            <option value="light">Light (white and gold)</option>
            <option value="dark">Dark (for dim worship spaces)</option>
            <option value="contrast">High contrast</option>
          </Select>
        </Field>
      </div>
    </Section>
  );
}

function Presentation() {
  const s = useSettings();
  const u = useUpdateSettings();
  const themes = useThemes();
  const displays = useLive((x) => x.displays);
  const themeSelect = (key: string, label: string) => (
    <Field label={label}>
      <Select value={setting(s.data, key, "")} onChange={(e) => u.mutate({ [key]: e.target.value || null })}>
        {themes.data?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <>
      <Section title="Output">
        <div className="space-y-4">
          <Field label="Output display" hint="The projector or second monitor. Automatic picks the first display that is not the main screen.">
            <Select value={setting(s.data, "presentation.outputDisplay", "")} onChange={(e) => u.mutate({ "presentation.outputDisplay": e.target.value || null })}>
              <option value="">Automatic</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Switch
            checked={setting(s.data, "presentation.advanceAcrossItems", false)}
            onChange={(v) => u.mutate({ "presentation.advanceAcrossItems": v })}
            label="Next continues into the next service item"
            description="Off: Next and the arrow keys (→ ↓ Space, and ← ↑ back) stop on the last slide of each item, so the output never moves to another song by accident; click the next item to continue. On: Next carries on into the next item and ↓ ↑ jump between items."
          />
          <Field label="Fade for Black, Clear, Logo and Stop" hint="How smoothly the output changes when you press these buttons.">
            <Select value={String(outputFadeMs(s.data))} onChange={(e) => u.mutate({ [OUTPUT_FADE_KEY]: Number(e.target.value) })} className="w-60">
              <option value="0">Off (switch at once)</option>
              <option value="300">Quick (0.3 seconds)</option>
              <option value="500">Smooth (0.5 seconds)</option>
              <option value="1000">Slow (1 second)</option>
            </Select>
          </Field>
        </div>
      </Section>
      <LogoScreenSettings />
      <Section title="Music" description="How a song with music looks on the output while it plays (Live page → Play music).">
        <div className="grid gap-3 md:grid-cols-3">
          <NumberField label="Lyric size" value={setting(s.data, "music.fontSize", 64)} min={24} max={160} step={4} onChange={(v) => u.mutate({ "music.fontSize": v })} />
          <Field label="Lyric alignment">
            <Select value={setting(s.data, "music.align", "center")} onChange={(e) => u.mutate({ "music.align": e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </Select>
          </Field>
          <Field label="When the music starts, show">
            <Select value={setting(s.data, "music.defaultView", "vinyl")} onChange={(e) => u.mutate({ "music.defaultView": e.target.value })}>
              <option value="vinyl">The vinyl record and the current line</option>
              <option value="lyrics">Large lyrics: current and next line</option>
              <option value="full">The whole song, following the music</option>
              <option value="slides">The song's slides</option>
            </Select>
          </Field>
        </div>
      </Section>
      <Section title="Default themes">
        <div className="grid gap-3 md:grid-cols-2">
          {themeSelect("presentation.defaultSongThemeId", "Songs")}
          {themeSelect("presentation.defaultScriptureThemeId", "Scripture")}
          {themeSelect("presentation.defaultAnnouncementThemeId", "Announcements")}
          {themeSelect("presentation.bibleNowThemeId", "Bible verses from Present now")}
        </div>
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => void navigate("themes")}>
          Edit themes (fonts, sizes, backgrounds, transitions) →
        </Button>
      </Section>
      <Section title="Slides">
        <div className="grid gap-3 md:grid-cols-2">
          <NumberField label="Lyric lines per slide" value={setting(s.data, "presentation.maxLinesPerSlide", 4)} min={1} max={12} onChange={(v) => u.mutate({ "presentation.maxLinesPerSlide": v })} />
          <NumberField label="Scripture characters per slide" value={setting(s.data, "presentation.maxScriptureCharsPerSlide", 320)} min={80} max={1200} step={20} onChange={(v) => u.mutate({ "presentation.maxScriptureCharsPerSlide": v })} />
          <Field label="Scripture slides">
            <Select value={setting(s.data, "presentation.scriptureSplit", "fit")} onChange={(e) => u.mutate({ "presentation.scriptureSplit": e.target.value })}>
              <option value="fit">Keep verses together, as many as fit</option>
              <option value="verse">One verse per slide</option>
            </Select>
          </Field>
          <TextField
            label="CCLI license number"
            value={setting(s.data, "presentation.ccliLicenseNumber", "")}
            onChange={(e) => u.mutate({ "presentation.ccliLicenseNumber": e.target.value })}
            hint="Added to the song footer when the theme shows song information."
          />
        </div>
        <div className="mt-4">
          <Switch
            checked={setting(s.data, "bible.hideParagraphMarks", true)}
            onChange={(v) => u.mutate({ "bible.hideParagraphMarks": v })}
            label="Hide paragraph marks (¶) in Scripture"
            description="Some translations include ¶ marks in the text. The stored text is never changed."
          />
        </div>
      </Section>
    </>
  );
}

function Library() {
  const s = useSettings();
  const u = useUpdateSettings();
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info });
  const translations = useQuery({ queryKey: ["translations"], queryFn: api.bible.translations });
  return (
    <>
      <Section title="Library location">
        <dl className="grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
          <dt className="text-subtle">Library folder</dt>
          <dd className="break-all selectable">{info.data?.dataDir}</dd>
          <dt className="text-subtle">Database</dt>
          <dd>
            {formatBytes(info.data?.dbSizeBytes)} · schema version {info.data?.schemaVersion}
          </dd>
          <dt className="text-subtle">Media folder</dt>
          <dd className="break-all selectable">{info.data?.mediaDir}</dd>
          <dt className="text-subtle">Free space</dt>
          <dd>{formatBytes(info.data?.freeDiskBytes)}</dd>
          <dt className="text-subtle">App version</dt>
          <dd>{info.data?.version}</dd>
        </dl>
        <Button className="mt-3" size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => info.data && void revealItemInDir(info.data.dbPath)}>
          Open library folder
        </Button>
      </Section>
      <Section title="Bible">
        <div className="space-y-4">
          <Field label="Default Bible translation">
            <Select value={setting(s.data, "bible.defaultTranslationId", "")} onChange={(e) => u.mutate({ "bible.defaultTranslationId": e.target.value || null })} className="w-80">
              <option value="">None</option>
              {translations.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
    </>
  );
}

function KeyboardSettings() {
  const s = useSettings();
  const u = useUpdateSettings();
  const map = normalizeShortcuts(s.data?.["keyboard.shortcuts"]);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const conflicts = findConflicts(map);
  const save = (next: typeof map) => u.mutate({ "keyboard.shortcuts": next });

  return (
    <Section title="Presentation shortcuts" description="Active on the Live Presentation page and on the output window. They never trigger while you are typing in a text box.">
      {conflicts.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {conflicts.map((c) => `${comboLabel(c.combo)} is used by ${c.actions.map((a) => SHORTCUT_LABELS[a]).join(" and ")}`).join(". ")}. The first action wins.
        </p>
      )}
      <table className="w-full text-sm">
        <tbody>
          {SHORTCUT_ACTIONS.map((a) => (
            <tr key={a} className="border-t border-border">
              <td className="py-2 pr-4">{SHORTCUT_LABELS[a]}</td>
              <td className="py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {map[a].map((combo) => (
                    <span key={combo} className="inline-flex items-center gap-1">
                      <Kbd>{comboLabel(combo)}</Kbd>
                      <button type="button" aria-label={`Remove ${comboLabel(combo)}`} className="text-subtle hover:text-text" onClick={() => save({ ...map, [a]: map[a].filter((c) => c !== combo) })}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {capturing === a ? (
                    <input
                      autoFocus
                      readOnly
                      data-shortcuts="off"
                      className="h-7 w-44 rounded border border-primary bg-bg px-2 text-xs"
                      value="Press a key… (Esc cancels)"
                      onBlur={() => setCapturing(null)}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        if (e.code === "Escape" && !e.ctrlKey) {
                          setCapturing(null);
                          return;
                        }
                        if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight"].includes(e.code)) return;
                        const combo = eventToCombo(e);
                        if (!map[a].includes(combo)) save({ ...map, [a]: [...map[a], combo] });
                        setCapturing(null);
                      }}
                    />
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Keyboard className="size-3.5" />} onClick={() => setCapturing(a)}>
                      Add key
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button className="mt-4" size="sm" variant="outline" icon={<RotateCcw className="size-3.5" />} onClick={() => save(DEFAULT_SHORTCUTS)}>
        Restore defaults
      </Button>
    </Section>
  );
}
