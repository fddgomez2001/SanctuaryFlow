import { useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, Lock, MonitorPlay, Music, Palette, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import type { SettingsMap } from "@/services/api";
import { APP_LOGO_URL } from "@/lib/default-art";
import { USER_NAME } from "@/lib/greeting";
import { cn } from "@/lib/cn";

/** Settings key: the first-start welcome was finished or skipped. */
export const WELCOME_DONE = "general.onboardingDone";

/** End-to-end tests start a new library every time; only the welcome's own test sees it. */
function welcomeAllowed(): boolean {
  const w = window as { __SANCTUARYFLOW_E2E__?: boolean; __SANCTUARYFLOW_E2E_WELCOME__?: boolean };
  return !w.__SANCTUARYFLOW_E2E__ || !!w.__SANCTUARYFLOW_E2E_WELCOME__;
}

/** True while the first-start welcome is still to be shown (the greeting waits for it). */
export function welcomePending(settings: SettingsMap | undefined): boolean {
  return !!settings && welcomeAllowed() && setting<boolean>(settings, WELCOME_DONE, false) !== true;
}

const GOLD = "linear-gradient(150deg, #2a1d06 0%, #5e400b 22%, #9a7224 46%, #d6b465 62%, #a67c28 78%, #6f4d10 100%)";

interface TourStep {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
}

/** The walkthrough: what SanctuaryFlow does, one page each. */
const TOUR: TourStep[] = [
  {
    icon: <CalendarDays />,
    eyebrow: "Service Planner",
    title: "Plan every service",
    text: "Build the order of worship once and present it in order on Sunday.",
    points: ["Songs, Scripture, announcements and videos", "Sermon slides from PowerPoint, PDF or a Canva link", "Reuse a service as a template"],
  },
  {
    icon: <Music />,
    eyebrow: "Song Library",
    title: "Your songs, beautifully",
    text: "Type or paste the lyrics; SanctuaryFlow turns them into slides with an elegant metallic gold look.",
    points: ["Verse, chorus and bridge labels", "Edits reach the live screen straight away", "Change the look in Presentation Themes"],
  },
  {
    icon: <BookOpen />,
    eyebrow: "Bible Library",
    title: "The Bible, even offline",
    text: "Install a translation once, then type a reference such as “John 3:16” wherever you are.",
    points: ["Whole chapters on the Live page", "Pick one verse or several", "Long verses split into readable slides"],
  },
  {
    icon: <MonitorPlay />,
    eyebrow: "Live Presentation",
    title: "Go Live with confidence",
    text: "Go Live puts your slides on the second screen. Previous and Next, or the arrow keys, move through them.",
    points: ["Present now: a song or verse in seconds", "Lock output to prepare what comes next", "Black, Clear and Logo whenever you need them"],
  },
];

type Step = { kind: "welcome" } | { kind: "name" } | { kind: "tour"; index: number } | { kind: "done" };
const STEPS: Step[] = [{ kind: "welcome" }, { kind: "name" }, ...TOUR.map((_, index) => ({ kind: "tour" as const, index })), { kind: "done" }];

/**
 * The first start: a welcome, the operator's name (to greet them by it) and a
 * short walkthrough. Every page can be skipped; Settings shows it again.
 */
export function Welcome() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [at, setAt] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [church, setChurch] = useState<string | null>(null);

  if (!welcomePending(settings.data)) return null;
  const savedName = setting(settings.data, USER_NAME, "");
  const savedChurch = setting(settings.data, "general.churchName", "");
  const typedName = (name ?? savedName).trim();
  const step = STEPS[at]!;
  const last = STEPS.length - 1;

  const finish = () => {
    const changes: Record<string, unknown> = { [WELCOME_DONE]: true };
    if (name !== null) changes[USER_NAME] = name.trim();
    if (church !== null) changes["general.churchName"] = church.trim();
    update.mutate(changes);
  };
  const next = () => (at >= last ? finish() : setAt(at + 1));
  const back = () => setAt(Math.max(0, at - 1));

  return (
    <D.Root open>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px]" style={{ animation: "sf-fade-in 400ms ease-out" }} />
        <D.Content
          data-shortcuts="off"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          // Enter or the arrow keys move through the pages (typing in a box is left alone).
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("input, textarea, button")) return;
            if (e.key === "Enter" || e.key === "ArrowRight") {
              e.preventDefault();
              next();
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              back();
            }
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(620px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl bg-panel shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] focus:outline-none"
          style={{ animation: "sf-rise-in 500ms ease-out" }}
        >
          <D.Title asChild>
            <span className="sr-only">Welcome to SanctuaryFlow</span>
          </D.Title>

          {/* The gold side: the logo, and where we are in the walkthrough. */}
          <div className="relative hidden w-[38%] shrink-0 flex-col justify-between overflow-hidden p-9 text-white md:flex" style={{ background: GOLD }}>
            <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(118deg, transparent 30%, rgb(255 246 214 / 0.22) 45%, transparent 60%), repeating-linear-gradient(100deg, rgb(255 255 255 / 0.03) 0 2px, transparent 2px 5px)" }} />
            <div className="relative flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgb(0_0_0/0.25)]">
                <img src={APP_LOGO_URL} alt="" className="size-9 object-contain" draggable={false} />
              </span>
              <span>
                <span className="block font-display text-xl font-semibold">SanctuaryFlow</span>
                <span className="block text-xs text-white/75">Worship presentation</span>
              </span>
            </div>
            <div key={at} className="relative" style={{ animation: "sf-rise-in 500ms ease-out both" }}>
              <SideArt step={step} />
            </div>
            <ol className="relative flex gap-1.5" aria-label="Progress">
              {STEPS.map((_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-label={`Page ${i + 1} of ${STEPS.length}`}
                    aria-current={i === at ? "step" : undefined}
                    onClick={() => setAt(i)}
                    className={cn("block h-1.5 rounded-full transition-all", i === at ? "w-7 bg-white" : i < at ? "w-3 bg-white/70" : "w-3 bg-white/30 hover:bg-white/50")}
                  />
                </li>
              ))}
            </ol>
          </div>

          {/* The page itself. */}
          <div className="relative flex min-w-0 flex-1 flex-col px-10 pt-8 pb-8 md:px-14">
            {step.kind !== "done" && (
              <button type="button" onClick={finish} className="absolute top-6 right-7 rounded-md px-2 py-1 text-sm font-medium text-subtle hover:bg-elevated hover:text-text">
                Skip
              </button>
            )}
            <div key={at} className="flex min-h-0 flex-1 flex-col justify-center" style={{ animation: "sf-fade-in 450ms ease-out both" }}>
              {step.kind === "welcome" && (
                <Page eyebrow="Welcome" title="Welcome to SanctuaryFlow">
                  <p className="max-w-md text-base leading-relaxed text-muted">
                    Songs, Scripture and whole services on the screen, beautifully and on time — even without the internet. Let’s get you ready for Sunday in a minute.
                  </p>
                </Page>
              )}
              {step.kind === "name" && (
                <Page eyebrow="About you" title="What should we call you?">
                  <form
                    className="max-w-sm space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      next();
                    }}
                  >
                    <label className="block">
                      <span className="field-label">Your name</span>
                      <Input autoFocus value={name ?? savedName} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={60} className="h-11 text-base" />
                    </label>
                    <label className="block">
                      <span className="field-label">Church name (optional)</span>
                      <Input value={church ?? savedChurch} onChange={(e) => setChurch(e.target.value)} placeholder="For the logo screen and the Home page" maxLength={120} className="h-11 text-base" />
                    </label>
                    <p className="text-xs text-subtle">SanctuaryFlow greets you by name each morning, afternoon and evening. Both stay on this computer.</p>
                    <button type="submit" hidden />
                  </form>
                </Page>
              )}
              {step.kind === "tour" && <TourPage step={TOUR[step.index]!} />}
              {step.kind === "done" && (
                <Page eyebrow="All set" title={typedName ? `You’re all set, ${typedName}!` : "You’re all set!"}>
                  <p className="max-w-md text-base leading-relaxed text-muted">
                    Start on the Home page: plan this Sunday’s service, add your songs and install a Bible translation. You can see this walkthrough again in Settings.
                  </p>
                </Page>
              )}
            </div>

            <div className="flex items-center gap-3 pt-6">
              {at > 0 && (
                <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={back}>
                  Back
                </Button>
              )}
              <span className="ml-auto text-xs text-subtle">
                {at + 1} of {STEPS.length}
              </span>
              <Button variant="primary" size="lg" className="min-w-40 rounded-full px-7" onClick={next}>
                {step.kind === "welcome" ? "Get started" : step.kind === "done" ? "Start using SanctuaryFlow" : "Next"}
                {step.kind === "done" ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
              </Button>
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Page({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <p className="text-[11px] font-semibold tracking-[0.25em] text-accent uppercase">{eyebrow}</p>
      <h2 className="font-display text-[2.6rem] leading-[1.1] font-semibold text-text">{title}</h2>
      <span aria-hidden className="block h-0.5 w-14 rounded-full bg-primary" />
      {children}
    </div>
  );
}

function TourPage({ step }: { step: TourStep }) {
  return (
    <Page eyebrow={step.eyebrow} title={step.title}>
      <p className="max-w-md text-base leading-relaxed text-muted">{step.text}</p>
      <ul className="max-w-md space-y-2.5">
        {step.points.map((p) => (
          <li key={p} className="flex items-start gap-3 text-sm text-text">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Check className="size-3.5" />
            </span>
            {p}
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** A large gold emblem for each page of the walkthrough. */
function SideArt({ step }: { step: Step }) {
  const icon = step.kind === "tour" ? TOUR[step.index]!.icon : step.kind === "done" ? <Check /> : step.kind === "name" ? <Sparkles /> : <Palette />;
  const caption =
    step.kind === "tour"
      ? TOUR[step.index]!.eyebrow
      : step.kind === "done"
        ? "Ready for Sunday"
        : step.kind === "name"
          ? "A personal greeting"
          : "Worship, beautifully presented";
  return (
    <div className="space-y-5">
      <span className="flex size-24 items-center justify-center rounded-3xl bg-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_12px_30px_-10px_rgb(0_0_0/0.45)] ring-1 ring-white/30 backdrop-blur [&>svg]:size-11">
        {icon}
      </span>
      <p className="font-display text-3xl leading-snug font-medium italic drop-shadow-[0_2px_6px_rgb(0_0_0/0.25)]">{caption}</p>
      {step.kind === "tour" && step.index === 3 && (
        <p className="flex items-center gap-2 text-sm text-white/85">
          <Lock className="size-4" /> Lock output keeps the screen steady while you prepare.
        </p>
      )}
    </div>
  );
}
