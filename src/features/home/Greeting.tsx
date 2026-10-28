import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { BookOpen } from "lucide-react";
import { api } from "@/services/api";
import { navigate } from "@/app/navigation";
import { Button } from "@/components/ui/Button";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { referenceBooks } from "@/lib/bible/canon";
import { formatReference, parseReferences } from "@/lib/bible/reference";
import { cleanText } from "@/lib/slides/scripture";
import { APP_LOGO_URL } from "@/lib/default-art";
import { dayPart, GREETING_ENABLED, greetingSlot, greetingTitle, greetingVerses, LAST_GREETING, shouldGreet, USER_NAME, type DayPart } from "@/lib/greeting";
import { welcomePending } from "@/features/welcome/Welcome";

const OUTFIT = '"Outfit Variable", "Inter Variable", sans-serif';

const SERIF = 'Georgia, "Times New Roman", serif';

/** Gold skies for each part of the day, in the interface's own palette. */
const SKY: Record<DayPart, string> = {
  morning:
    "radial-gradient(120% 90% at 50% 120%, rgb(255 246 214 / 0.75), transparent 60%), linear-gradient(170deg, #f4d68f 0%, #d9a845 50%, #a77a22 100%)",
  afternoon:
    "radial-gradient(70% 70% at 82% 18%, rgb(255 250 230 / 0.6), transparent 60%), linear-gradient(170deg, #e9c46a 0%, #c4952f 55%, #8a6417 100%)",
  evening:
    "radial-gradient(1.5px 1.5px at 18% 30%, #fff8, transparent), radial-gradient(1.5px 1.5px at 72% 22%, #fff9, transparent), radial-gradient(1px 1px at 40% 62%, #fff7, transparent), radial-gradient(1px 1px at 86% 58%, #fff6, transparent), linear-gradient(170deg, #1f2d4d 0%, #2c3558 55%, #8a6417 135%)",
};

/** End-to-end tests start a new library every time; only the greeting's own test sees it. */
function greetingAllowed(): boolean {
  const w = window as { __SANCTUARYFLOW_E2E__?: boolean; __SANCTUARYFLOW_E2E_GREETING__?: boolean };
  return !w.__SANCTUARYFLOW_E2E__ || !!w.__SANCTUARYFLOW_E2E_GREETING__;
}

export type GreetingVerse = { text: string; reference: string } | { missing: "translation" | "verse" };

/** Today's verse from the default translation (or the first one installed). */
export async function findVerse(now: Date, translationId: string | null, hideMarks: boolean): Promise<GreetingVerse> {
  const translations = await api.bible.translations();
  const translation = translations.find((t) => t.id === translationId) ?? translations[0];
  if (!translation) return { missing: "translation" };
  const books = referenceBooks();
  for (const text of greetingVerses(now)) {
    const [parsed] = parseReferences(text, books);
    if (!parsed?.ok) continue;
    const passage = await api.bible.passage(translation.id, parsed.ref).catch(() => null);
    if (!passage?.verses.length) continue;
    return {
      text: passage.verses.map((v) => cleanText(v.text, hideMarks)).join(" "),
      reference: `${formatReference(passage.bookName, passage.reference)} (${passage.translationCode})`,
    };
  }
  return { missing: "verse" };
}

/**
 * Greets the operator with a Bible verse when SanctuaryFlow opens: once each
 * morning, afternoon and evening. Opening it again in the same part of the
 * day does not greet again.
 */
export function Greeting() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [now, setNow] = useState<Date | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    // On the first start the welcome comes first; the greeting follows it.
    if (decided.current || !settings.data || welcomePending(settings.data)) return;
    decided.current = true;
    const opened = new Date();
    if (!greetingAllowed() || !setting(settings.data, GREETING_ENABLED, true) || !shouldGreet(opened, settings.data[LAST_GREETING])) return;
    setNow(opened);
    update.mutate({ [LAST_GREETING]: greetingSlot(opened) });
  }, [settings.data, update]);

  const translationId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const hideMarks = setting(settings.data, "bible.hideParagraphMarks", true);
  const verse = useQuery({
    queryKey: ["greeting-verse", now?.getTime(), translationId],
    queryFn: () => findVerse(now!, translationId, hideMarks),
    enabled: !!now,
    staleTime: Infinity,
    retry: false,
  });

  if (!now) return null;
  const part = dayPart(now);
  const sky = SKY[part];
  const churchName = setting(settings.data, "general.churchName", "").trim();
  const close = () => setNow(null);
  const v = verse.data;

  return (
    <D.Root open onOpenChange={(open) => !open && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" style={{ animation: "sf-fade-in 400ms ease-out" }} />
        <D.Content
          data-shortcuts="off"
          // No focus ring on opening; Enter continues, as does Escape.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onKeyDown={(e) => e.key === "Enter" && close()}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-48px)] max-w-[34rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-panel shadow-[0_24px_60px_-12px_rgb(0_0_0/0.45)] focus:outline-none"
          style={{ animation: "sf-rise-in 500ms ease-out" }}
        >
          <div className="relative px-8 pt-7 pb-6 text-center text-white" style={{ background: sky }}>
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgb(0_0_0/0.18)] ring-4 ring-white/35" aria-hidden>
              <img src={APP_LOGO_URL} alt="" className="size-11 object-contain" draggable={false} />
            </span>
            <D.Title className="mt-3 text-[2.1rem] leading-tight font-semibold drop-shadow-[0_2px_6px_rgb(0_0_0/0.25)]" style={{ fontFamily: OUTFIT }}>
              {greetingTitle(part, settings.data?.[USER_NAME])}
            </D.Title>
            <p className="mt-1 text-sm font-medium text-white/90 drop-shadow-[0_1px_2px_rgb(0_0_0/0.3)]">
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              {churchName ? ` · ${churchName}` : ""}
            </p>
          </div>
          <div className="px-9 pt-6 pb-7 text-center">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-accent uppercase">Verse for today</p>
            <D.Description asChild>
              <div className="mt-3 min-h-24">
                {!v ? (
                  <div className="mx-auto mt-2 max-w-sm space-y-2" aria-label="Finding today's verse">
                    <div className="h-4 animate-pulse rounded bg-elevated" />
                    <div className="mx-auto h-4 w-4/5 animate-pulse rounded bg-elevated" />
                    <div className="mx-auto h-4 w-3/5 animate-pulse rounded bg-elevated" />
                  </div>
                ) : "text" in v ? (
                  <figure className="selectable">
                    <span aria-hidden className="block h-8 text-6xl leading-none text-primary/40" style={{ fontFamily: SERIF }}>
                      “
                    </span>
                    <blockquote className="text-[1.15rem] leading-relaxed text-text" style={{ fontFamily: SERIF }}>
                      {v.text}
                    </blockquote>
                    <figcaption className="mt-4 flex items-center justify-center gap-3 text-sm font-semibold tracking-wide text-accent">
                      <span aria-hidden className="h-px w-8 bg-primary/50" />
                      {v.reference}
                      <span aria-hidden className="h-px w-8 bg-primary/50" />
                    </figcaption>
                  </figure>
                ) : (
                  <div className="space-y-3 text-sm text-muted">
                    <p>
                      {v.missing === "translation"
                        ? "Add a Bible translation in the Bible Library and a verse will greet you here."
                        : "Today's greeting verses are not in your Bible translation."}
                    </p>
                    {v.missing === "translation" && (
                      <Button
                        size="sm"
                        icon={<BookOpen className="size-3.5" />}
                        onClick={() => {
                          close();
                          void navigate("bible");
                        }}
                      >
                        Open the Bible Library
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </D.Description>
            <Button variant="primary" size="lg" className="mt-7 min-w-44 rounded-full px-8 shadow-sm" onClick={close}>
              Continue
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
