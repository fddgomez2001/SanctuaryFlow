import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChartColumn, CalendarDays, CalendarPlus, CheckCircle2, Circle, FolderOpen, Images, ListMusic, MonitorPlay, Music, Play, Quote, Sparkles } from "lucide-react";
import type { DashboardSummary } from "@/types/generated/DashboardSummary";
import type { MonthCount } from "@/types/generated/MonthCount";
import { navigate } from "@/app/navigation";
import { api } from "@/services/api";
import { setting, useSettings } from "@/hooks/useSettings";
import { formatServiceTime, nextSundayIso, timeAgo, todayIso } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ErrorNotice, LoadingBlock } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toast";
import { useLive } from "@/services/presentation-engine/store";
import { mediaRef } from "@/services/presentation-engine/media";
import { cn } from "@/lib/cn";
import { dayPart, USER_NAME } from "@/lib/greeting";
import { APP_LOGO_URL } from "@/lib/default-art";
import type { ItemKind } from "@/lib/service-items";
import { ItemIcon } from "@/features/services/ItemIcon";
import { ServiceDateTile } from "@/features/services/ServiceDetailsDialog";
import { ArtistCover, useArtistCovers } from "@/features/songs/artists";
import { artistKey } from "@/lib/artists";
import { findVerse } from "./Greeting";

export async function createServiceForNextSunday(title = "Sunday Service"): Promise<void> {
  try {
    const plan = await api.services.save({
      id: null,
      title,
      serviceDate: nextSundayIso(),
      serviceTime: null,
      description: null,
      notes: null,
      status: "draft",
      isTemplate: false,
      themeId: null,
      items: [],
    });
    await navigate("services", { planId: plan.id });
  } catch (e) {
    toast.error("The service could not be created", e);
  }
}

const GREETING = { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" } as const;

/** The cover when the library has no pictures yet: brushed metallic gold. */
const GOLD_COVER =
  "repeating-linear-gradient(100deg, rgb(255 255 255 / 0.035) 0 2px, transparent 2px 5px), linear-gradient(118deg, transparent 28%, rgb(255 246 214 / 0.3) 42%, transparent 56%), linear-gradient(135deg, #5e400b 0%, #9a7224 20%, #d6b465 36%, #a67c28 52%, #6f4d10 68%, #b48a35 84%, #dcbc6c 100%)";

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Sunday, 9:30 AM" (the date tile beside it shows the day of the month). */
function when(date: string | null, time: string | null): string {
  const day = date ? new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: "long" }) : null;
  return [day, time ? formatServiceTime(time) : null].filter(Boolean).join(", ");
}

/** "2026-10" → "Oct" or "October 2026". */
function monthName(month: string, long = false): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return d.toLocaleDateString(undefined, long ? { month: "long", year: "numeric" } : { month: "short" });
}

/**
 * Home, laid out like a church's page: a cover of the library's own pictures,
 * the logo and a greeting, then what is coming up and how the library is used.
 * Every number comes from the library on this computer.
 */
export function HomePage() {
  const settings = useSettings();
  const churchName = setting(settings.data, "general.churchName", "").trim();
  const userName = setting(settings.data, USER_NAME, "").trim();
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info });
  // Fresh numbers each time Home opens.
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.app.dashboard(todayIso()), refetchOnMount: "always" });

  if (dash.isLoading) return <LoadingBlock />;
  if (dash.isError) return <div className="p-6"><ErrorNotice title="The dashboard could not be loaded" message={String(dash.error)} /></div>;
  const d = dash.data!;
  const empty = d.counts.songs === 0 && d.counts.translations === 0 && d.counts.servicePlans === 0;
  const recent = d.recentServices[0];
  const now = new Date();
  const hello = `${GREETING[dayPart(now)]}${userName ? `, ${userName}` : ""}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1320px] px-6 pt-5 pb-10">
        <Cover />

        {/* The profile row: the logo over the cover's edge, the greeting and the main actions. */}
        <div className="relative z-10 flex flex-wrap items-start gap-x-6 gap-y-3 px-6">
          <span className="-mt-14 flex size-28 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_10px_28px_-8px_rgb(0_0_0/0.45)] ring-[5px] ring-bg">
            <img src={APP_LOGO_URL} alt="" className="size-20 object-contain" draggable={false} />
          </span>
          <div className="min-w-0 flex-1 pt-4">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-accent uppercase">
              {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <h1 className="mt-1 truncate font-display text-[2.5rem] leading-[1.1] font-semibold text-text">{hello}</h1>
            <p className="mt-1.5 truncate text-sm text-muted">
              {[churchName || "SanctuaryFlow", count(d.counts.songs, "song", "songs"), count(d.counts.servicePlans, "service", "services"), count(d.counts.media, "media file", "media files")].join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-8">
            <Button variant="primary" size="lg" className="rounded-full px-6 shadow-sm" icon={<MonitorPlay className="size-4" />} onClick={() => void navigate("live")}>
              Start presentation
            </Button>
            <Button size="lg" className="rounded-full px-5" icon={<CalendarPlus className="size-4" />} onClick={() => void createServiceForNextSunday()}>
              Plan Sunday
            </Button>
            {recent && (
              <Button size="lg" className="max-w-72 rounded-full px-5" icon={<FolderOpen className="size-4" />} onClick={() => void navigate("services", { planId: recent.id })}>
                <span className="truncate">Open “{recent.title}”</span>
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {info.data?.notices.map((n) => (
            <div key={n} className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-text">
              {n}
            </div>
          ))}
          {empty && <GettingStarted d={d} churchName={churchName} />}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <aside className="space-y-5">
            <VerseCard now={now} />
            <UpcomingCard d={d} />
            <ScriptureCard d={d} />
          </aside>
          <div className="min-w-0 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <StatTile
                icon={<Music />}
                label="Songs"
                value={d.counts.songs}
                note="added in the last 6 months"
                trend={d.songsByMonth}
                trendLabel="Songs added"
              />
              <StatTile
                icon={<CalendarDays />}
                label="Services"
                value={d.counts.servicePlans}
                note="planned by month"
                trend={d.servicesByMonth}
                trendLabel="Services"
              />
              <StatTile icon={<Sparkles />} label="Times presented" value={d.songUses + d.scriptureUses} note={`${count(d.songUses, "song", "songs")} · ${d.scriptureUses.toLocaleString()} Scripture`} />
              <StatTile icon={<Images />} label="Media files" value={d.counts.media} note="pictures, videos and audio" />
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <ServicesChart months={d.servicesByMonth} />
              <TopSongs d={d} />
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <ItemMix d={d} />
              <RecentSongs d={d} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The cover: the library's pictures, one fading into the next; brushed gold without any. */
function Cover() {
  const images = useQuery({ queryKey: ["media", "home-cover"], queryFn: () => api.media.list({ kind: "image", text: null }), refetchOnMount: "always" });
  const pictures = useMemo(
    () =>
      (images.data ?? [])
        .filter((m) => !m.missing)
        .slice(0, 8)
        .map((m) => ({ id: m.id, url: mediaRef(m)?.url }))
        .filter((p): p is { id: string; url: string } => !!p.url),
    [images.data],
  );
  const [index, setIndex] = useState(0);
  const calm = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  useEffect(() => {
    if (pictures.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % pictures.length), 7000);
    return () => clearInterval(t);
  }, [pictures.length]);
  const picture = pictures.length ? pictures[index % pictures.length] : undefined;
  return (
    <section aria-label="Cover" className="relative h-60 overflow-hidden rounded-3xl bg-[#0d0f13] shadow-[0_18px_40px_-18px_rgb(0_0_0/0.55)]">
      {picture ? (
        <img
          key={picture.id}
          src={picture.url}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ animation: calm ? "sf-fade-in 1200ms ease-out both" : "sf-fade-in 1200ms ease-out both, sf-kenburns 8000ms ease-out both" }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: GOLD_COVER }}>
          <img src={APP_LOGO_URL} alt="" aria-hidden draggable={false} className="absolute top-1/2 right-[8%] size-52 -translate-y-1/2 object-contain opacity-20 mix-blend-soft-light" />
        </div>
      )}
      <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgb(8 9 12 / 0.55) 0%, transparent 55%)" }} />
    </section>
  );
}

function Card({ title, icon, action, children, className }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel flex min-w-0 flex-col rounded-2xl", className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h2 className="flex items-center gap-2.5 font-display text-[1.15rem] font-semibold text-text">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-primary [&>svg]:size-4">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 px-5 pb-5">{children}</div>
    </section>
  );
}

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-3">
      <p className="text-sm text-subtle">{children}</p>
      {action}
    </div>
  );
}

function GettingStarted({ d, churchName }: { d: DashboardSummary; churchName: string }) {
  const steps = [
    { done: !!churchName, label: "Enter your church name", action: () => void navigate("settings") },
    { done: d.counts.translations > 0, label: "Install a Bible translation", action: () => void navigate("bible", { tab: "translations" }) },
    { done: d.counts.songs > 0, label: "Add or import your songs", action: () => void navigate("songs") },
    { done: d.counts.servicePlans > 0, label: "Plan your first service", action: () => void createServiceForNextSunday() },
    { done: !!d.lastBackupAt, label: "Make your first backup", action: () => void navigate("backup") },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="panel rounded-2xl p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Set up SanctuaryFlow</h2>
          <p className="mt-1 text-sm text-muted">These steps get you ready for Sunday. Everything is stored on this computer and works without the internet.</p>
        </div>
        <div className="w-48">
          <p className="text-right text-xs text-subtle">
            {done} of {steps.length} done
          </p>
          <div className="mt-1 h-1.5 rounded-full bg-primary/15">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.label}>
            <button type="button" onClick={s.action} className="flex h-full w-full items-center gap-3 rounded-xl border border-border bg-bg px-3 py-3 text-left transition hover:border-primary">
              {s.done ? <CheckCircle2 className="size-5 shrink-0 text-primary" /> : <Circle className="size-5 shrink-0 text-subtle" />}
              <span className="text-sm">
                <span className="text-subtle">{i + 1}. </span>
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Today's verse, the same one the greeting shows, from the installed Bible. */
function VerseCard({ now }: { now: Date }) {
  const settings = useSettings();
  const translationId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const hideMarks = setting(settings.data, "bible.hideParagraphMarks", true);
  const part = dayPart(now);
  const verse = useQuery({
    queryKey: ["home-verse", now.toDateString(), part, translationId, hideMarks],
    queryFn: () => findVerse(now, translationId, hideMarks),
    staleTime: Infinity,
    retry: false,
  });
  const v = verse.data;
  return (
    <section className="relative overflow-hidden rounded-2xl p-6 text-white shadow-[0_14px_32px_-16px_rgb(0_0_0/0.55)]" style={{ background: GOLD_COVER }}>
      <Quote aria-hidden className="absolute -top-2 right-3 size-24 text-white/15" />
      <p className="relative text-[11px] font-semibold tracking-[0.22em] text-white/85 uppercase">Verse for today</p>
      {!v ? (
        <div className="relative mt-4 space-y-2" aria-label="Finding today's verse">
          <div className="h-4 animate-pulse rounded bg-white/25" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-white/25" />
        </div>
      ) : "text" in v ? (
        <figure className="selectable relative mt-3">
          <blockquote className="font-display text-[1.2rem] leading-relaxed italic drop-shadow-[0_1px_3px_rgb(0_0_0/0.35)]">{v.text}</blockquote>
          <figcaption className="mt-3 text-sm font-semibold tracking-wide text-white/90">— {v.reference}</figcaption>
        </figure>
      ) : (
        <div className="relative mt-3 space-y-3">
          <p className="text-sm text-white/90">
            {v.missing === "translation" ? "Install a Bible translation and a verse for each part of the day will appear here." : "Today's verses are not in your Bible translation."}
          </p>
          {v.missing === "translation" && (
            <button type="button" onClick={() => void navigate("bible", { tab: "translations" })} className="rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium ring-1 ring-white/40 backdrop-blur hover:bg-white/30">
              Open the Bible Library
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function UpcomingCard({ d }: { d: DashboardSummary }) {
  const loadService = useLive((s) => s.loadService);
  return (
    <Card title="Coming up" icon={<CalendarDays />} action={<Button size="sm" variant="ghost" onClick={() => void navigate("services")}>All services</Button>}>
      {d.upcomingServices.length === 0 ? (
        <Empty action={<Button size="sm" variant="primary" icon={<CalendarPlus className="size-3.5" />} onClick={() => void createServiceForNextSunday()}>Plan Sunday</Button>}>
          No upcoming services are planned.
        </Empty>
      ) : (
        <ul className="-mx-2 space-y-1">
          {d.upcomingServices.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-elevated">
              <button type="button" onClick={() => void navigate("services", { planId: p.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <ServiceDateTile date={p.serviceDate} isTemplate={p.isTemplate} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text">{p.title}</span>
                  <span className="block truncate text-xs text-subtle">
                    {[when(p.serviceDate, p.serviceTime), count(p.itemCount, "item", "items")].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
              <Tooltip content="Present this service">
                <button
                  type="button"
                  aria-label={`Present “${p.title}”`}
                  onClick={() => void loadService(p.id).then(() => navigate("live"))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-primary transition hover:border-primary hover:bg-primary hover:text-white"
                >
                  <Play className="size-3.5 fill-current" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScriptureCard({ d }: { d: DashboardSummary }) {
  return (
    <Card title="Recent Scripture" icon={<BookOpen />}>
      {d.recentPassages.length === 0 ? (
        <Empty>Passages you present will appear here.</Empty>
      ) : (
        <div className="flex flex-wrap gap-2">
          {d.recentPassages.map((p) => (
            <Tooltip key={p.id} content={`Used ${timeAgo(p.lastUsedAt)}`}>
              <button
                type="button"
                onClick={() => void navigate("bible", { reference: p.reference })}
                className="rounded-full border border-border bg-bg px-3 py-1 text-sm text-text transition hover:border-primary hover:text-accent"
              >
                {p.reference}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </Card>
  );
}

/** A headline number, with its last six months as a small line when there is a trend. */
function StatTile({ icon, label, value, note, trend, trendLabel }: { icon: ReactNode; label: string; value: number; note: string; trend?: MonthCount[]; trendLabel?: string }) {
  return (
    <section className="panel flex min-w-0 flex-col gap-3 rounded-2xl p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary [&>svg]:size-4">{icon}</span>
        <h3 className="truncate text-sm font-medium text-muted">{label}</h3>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl leading-none font-semibold text-text">{value.toLocaleString()}</p>
        {trend && trend.length > 1 && <Sparkline months={trend} label={trendLabel ?? label} />}
      </div>
      <p className="truncate text-xs text-subtle">{note}</p>
    </section>
  );
}

function Sparkline({ months, label }: { months: MonthCount[]; label: string }) {
  const W = 96;
  const H = 34;
  const pad = 5;
  const max = Math.max(1, ...months.map((m) => m.count));
  const pts = months.map((m, i) => [pad + (i * (W - 2 * pad)) / (months.length - 1), H - pad - (m.count / max) * (H - 2 * pad)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  const summary = months.map((m) => `${monthName(m.month)} ${m.count}`).join(", ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${summary}`} className="shrink-0 overflow-visible">
      <path d={`${line} L${lx},${H - pad} L${pts[0]![0]},${H - pad} Z`} fill="var(--color-primary)" opacity={0.1} />
      <path d={line} fill="none" stroke="var(--color-primary)" strokeOpacity={0.5} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={4} fill="var(--color-primary)" stroke="var(--color-panel)" strokeWidth={2} />
      {pts.map(([x], i) => (
        <rect key={months[i]!.month} x={x - W / months.length / 2} y={0} width={W / months.length} height={H} fill="transparent">
          <title>{`${monthName(months[i]!.month, true)}: ${months[i]!.count}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Services per month: four months back, this month and next (planned ahead). */
function ServicesChart({ months }: { months: MonthCount[] }) {
  const thisMonth = todayIso().slice(0, 7);
  const max = Math.max(1, ...months.map((m) => m.count));
  const total = months.reduce((n, m) => n + m.count, 0);
  const PLOT = 132;
  return (
    <Card title="Services by month" icon={<ChartColumn />}>
      {total === 0 ? (
        <Empty action={<Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => void createServiceForNextSunday()}>Plan Sunday</Button>}>
          Services you plan will be counted here, month by month.
        </Empty>
      ) : (
        <figure>
          <div className="relative flex items-end gap-2 border-b border-border px-1" style={{ height: PLOT + 22 }}>
            <span aria-hidden className="absolute inset-x-0 border-t border-border/70" style={{ bottom: PLOT }} />
            <span aria-hidden className="absolute left-0 text-[10px] leading-none text-subtle tabular-nums" style={{ bottom: PLOT + 3 }}>
              {max}
            </span>
            {months.map((m) => {
              const future = m.month > thisMonth;
              const current = m.month === thisMonth;
              const h = (m.count / max) * PLOT;
              return (
                <Tooltip key={m.month} content={`${monthName(m.month, true)}: ${count(m.count, "service", "services")}${future ? " planned" : ""}`}>
                  <div tabIndex={0} aria-label={`${monthName(m.month, true)}: ${count(m.count, "service", "services")}`} className="group flex h-full flex-1 flex-col items-center justify-end outline-none">
                    <span className={cn("mb-1 text-xs font-semibold text-text tabular-nums", current ? "" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>{m.count}</span>
                    <span
                      className="block w-full max-w-6 rounded-t-[4px] transition-[filter] group-hover:brightness-110"
                      style={{
                        height: m.count ? Math.max(4, h) : 0,
                        background: future ? "color-mix(in srgb, var(--color-primary) 45%, transparent)" : "var(--color-primary)",
                      }}
                    />
                  </div>
                </Tooltip>
              );
            })}
          </div>
          <div className="flex gap-2 px-1 pt-1.5">
            {months.map((m) => (
              <span key={m.month} className={cn("flex-1 text-center text-xs", m.month === thisMonth ? "font-semibold text-text" : "text-subtle")}>
                {monthName(m.month)}
              </span>
            ))}
          </div>
          <figcaption className="mt-2 text-xs text-subtle">Next month in a lighter gold: services already planned.</figcaption>
        </figure>
      )}
    </Card>
  );
}

function TopSongs({ d }: { d: DashboardSummary }) {
  const covers = useArtistCovers();
  const max = Math.max(1, ...d.topSongs.map((s) => s.useCount));
  return (
    <Card title="Most presented songs" icon={<ListMusic />}>
      {d.topSongs.length === 0 ? (
        <Empty>Present a song on the Live page and your most sung songs will rank here.</Empty>
      ) : (
        <ol className="-mx-2 space-y-0.5">
          {d.topSongs.map((s, i) => {
            const url = covers.coverUrl(artistKey(s.artist));
            return (
              <li key={s.id}>
                <button type="button" onClick={() => void navigate("songs", { songId: s.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-elevated">
                  <span className="w-3 text-xs font-semibold text-subtle tabular-nums">{i + 1}</span>
                  <ArtistCover name={s.artist ?? s.title} url={url} contain={covers.isDefault(url)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-text">{s.title}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{count(s.useCount, "time", "times")}</span>
                    </span>
                    <span className="mt-1 block h-2 rounded-full bg-primary/12">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${(s.useCount / max) * 100}%` }} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

const ITEM_LABELS: Partial<Record<ItemKind, string>> = {
  song: "Songs",
  scripture: "Scripture",
  announcement: "Announcements",
  sermon: "Sermon slides",
  image: "Pictures",
  video: "Videos",
  custom: "Custom slides",
};

/** What the services are made of: each kind of item and its share. */
function ItemMix({ d }: { d: DashboardSummary }) {
  const total = d.itemMix.reduce((n, x) => n + x.count, 0);
  return (
    <Card title="What your services include" icon={<CalendarDays />}>
      {total === 0 ? (
        <Empty>Add songs, Scripture and announcements to a service to see the mix here.</Empty>
      ) : (
        <ul className="space-y-3">
          {d.itemMix.map((x) => {
            const share = Math.round((x.count / total) * 100);
            const kind = x.itemType as ItemKind;
            return (
              <li key={x.itemType} className="flex items-center gap-3">
                <ItemIcon kind={kind} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-text">{ITEM_LABELS[kind] ?? x.itemType}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {x.count.toLocaleString()} · {share}%
                    </span>
                  </span>
                  <span className="mt-1 block h-2 rounded-full bg-primary/12">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, share)}%` }} />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentSongs({ d }: { d: DashboardSummary }) {
  const covers = useArtistCovers();
  return (
    <Card title="Recently presented" icon={<Music />} action={<Button size="sm" variant="ghost" onClick={() => void navigate("songs")}>Song Library</Button>}>
      {d.recentSongs.length === 0 ? (
        <Empty>Songs you present will appear here.</Empty>
      ) : (
        <ul className="-mx-2 grid gap-0.5">
          {d.recentSongs.slice(0, 5).map((s) => {
            const url = covers.coverUrl(artistKey(s.artist));
            return (
              <li key={s.id}>
                <button type="button" onClick={() => void navigate("songs", { songId: s.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-elevated">
                  <ArtistCover name={s.artist ?? s.title} url={url} contain={covers.isDefault(url)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{s.title}</span>
                    <span className="block truncate text-xs text-subtle">{[s.artist, timeAgo(s.lastUsedAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
