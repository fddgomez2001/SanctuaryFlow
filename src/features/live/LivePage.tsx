import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Eraser, Film, Globe, History, LayoutGrid, List, Lock, LockOpen, MonitorPlay, Paintbrush, Pause, Play, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { EmptyState, Kbd } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { useSettings } from "@/hooks/useSettings";
import { useThemes } from "@/hooks/useThemes";
import { comboLabel, eventToCombo, isEditableTarget, matchShortcut, normalizeShortcuts, type ShortcutMap } from "@/lib/keyboard";
import { formatDuration, timeAgo } from "@/lib/format";
import { currentSlide, nextSlide, positionLabel } from "@/services/presentation-engine/engine";
import { buildRenderState, isBibleNow, itemTheme, useLive } from "@/services/presentation-engine/store";
import { ImportPresentationDialog } from "@/features/services/ImportPresentationDialog";
import { useStoredState } from "@/hooks/useStoredState";
import { canvaPagesOf, canvaPicturesOf, canvaUrlOf, themeIdOf } from "@/lib/service-items";
import { newId } from "@/lib/slides/deck";
import { LiveLineup } from "./LiveLineup";
import { MusicControls } from "./MusicControls";
import { QuickThemeEditor, useThemeEditor } from "./QuickThemeEditor";
import { CanvaPageCount, CanvaPagesDialog, canvaLinkOf, withCanvaPages } from "@/features/services/CanvaPagesFlow";
import { CanvaPicturesControl, takeCanvaPictures, useCanvaPictures } from "@/features/services/canvaPictures";
import { LiveSlides, type SlideView } from "./LiveSlides";
import { LiveHeader } from "./LiveHeader";
import { LiveHome } from "./LiveHome";
import { QuickPresentBar } from "./QuickPresentBar";
import { AddPassageDialog, BibleChapter } from "./BibleChapter";
import { useBibleNow } from "./bibleNow";
import { cn } from "@/lib/cn";

export function LivePage() {
  const live = useLive();
  const settings = useSettings();
  const shortcuts = useMemo(() => normalizeShortcuts(settings.data?.["keyboard.shortcuts"]), [settings.data]);
  const { engine, projector } = live;
  const themes = useThemes();
  const bible = useBibleNow();
  const [browsing, setBrowsing] = useState(false);

  // Presentation shortcuts on this page (never while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code !== "ArrowRight" && e.code !== "ArrowLeft") return;
      // A key another control already used (Space picking up a drag handle) is not a shortcut.
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector("[role='dialog'], [role='menu']")) return;
      const action = matchShortcut(shortcuts, eventToCombo(e));
      if (!action) return;
      e.preventDefault();
      useLive.getState().shortcut(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  const selectedIndex = engine.selectedItemIndex ?? engine.live?.itemIndex ?? null;
  const selectedItem = selectedIndex != null ? engine.items[selectedIndex] : null;
  const current = currentSlide(engine);
  const next = nextSlide(engine, live.options);
  const render = buildRenderState(live);
  const aspect = render.aspect;
  const [slideView, setSlideView] = useStoredState<SlideView>("live.slideView", "grid");
  const [importing, setImporting] = useState(false);
  const source = selectedItem ? [...live.serviceItems, ...live.adhocItems].find((i) => i.id === selectedItem.id) : undefined;
  const ownThemeId = source ? themeIdOf(source.settings ?? {}) : null;
  const canva = canvaLinkOf(source?.settings);
  const [canvaPages, setCanvaPages] = useState(false);
  const isVideo = current?.content.kind === "media" && current.content.mediaType === "video";
  const nextItem = next ? engine.items.find((i) => i.id === next.itemId) : null;
  const liveItem = engine.live ? engine.items[engine.live.itemIndex] : null;

  // Choosing an item in the lineup puts the Bible view away (Present now brings it back).
  const selectedId = selectedItem?.id;
  useEffect(() => {
    if (selectedId && !isBibleNow(selectedId) && useBibleNow.getState().open) useBibleNow.getState().setOpen(false);
  }, [selectedId]);

  // A Canva design shown live gets a real picture of each page as its thumbnails.
  // Pictures are kept on each computer, so one synchronized from elsewhere counts as missing.
  const liveCanva = source && canva && !canva.brought ? source : null;
  const picturesHere = (settings: Record<string, unknown>) => {
    const media = useLive.getState().media;
    return canvaPicturesOf(settings).map((id) => (id && media[id] ? id : null));
  };
  const picturesMissing = !!liveCanva && !live.loading && picturesHere(liveCanva.settings ?? {}).some((p) => !p);
  const picturesBusy = useCanvaPictures((s) => !!s.job);
  const picturesStopped = useCanvaPictures((s) => (liveCanva ? !!s.problems[liveCanva.id] : false));
  const takePictures = (retake: boolean) => {
    const item = liveCanva;
    const url = item ? canvaUrlOf(item.settings ?? {}) : null;
    if (!item || !url) return;
    void takeCanvaPictures({
      itemId: item.id,
      title: item.title,
      url,
      pictures: picturesHere(item.settings ?? {}),
      retake,
      save: (pictures, aspect) =>
        useLive.getState().updateItem(item.id, (i) => ({ ...i, settings: { ...i.settings, canvaPictures: pictures, canvaAspect: aspect } })),
    }).then((result) => {
      if (retake && result === "done") toast.success(`New page pictures for “${item.title}”`);
    });
  };
  useEffect(() => {
    if (picturesMissing && !picturesBusy && !picturesStopped) takePictures(false);
    // takePictures reads the selected item; these say when it needs pictures.
  }, [liveCanva?.id, picturesMissing, picturesBusy, picturesStopped]);

  const showBible = bible.open && !!bible.chapter;
  // While the output is locked, a slide chosen elsewhere is prepared (cued), not shown.
  const lockedItem = live.locked ? engine.items.find((i) => i.id === live.locked) : null;
  const cueItem = live.cue ? engine.items.find((i) => i.id === live.cue!.itemId) : null;
  const cueLabel = cueItem ? (isBibleNow(cueItem.id) ? cueItem.title : `${cueItem.title} — ${cueItem.slides[live.cue!.slideIndex]?.label ?? ""}`) : null;
  const selectedIsLive = engine.live?.itemIndex === selectedIndex;
  const cueIndex = live.cue && selectedItem && live.cue.itemId === selectedItem.id ? live.cue.slideIndex : null;
  const showHome = browsing || (!live.serviceId && engine.items.length === 0 && !showBible && !live.loading);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LiveHeader onBrowse={() => setBrowsing(true)} />

      <QuickThemeEditor />
      <AddPassageDialog />
      {selectedItem && canva && (
        <CanvaPagesDialog
          open={canvaPages}
          onClose={() => setCanvaPages(false)}
          title={selectedItem.title}
          link={canva.link}
          update={canva.brought}
          onImported={(deck, warnings) => {
            setCanvaPages(false);
            void live
              .updateItem(selectedItem.id, (i) => withCanvaPages(i, deck.id, canva.link))
              .then(() => toast.success(`“${selectedItem.title}” now has ${deck.slides.length} page${deck.slides.length === 1 ? "" : "s"} from Canva`, warnings.join(" ") || undefined))
              .catch((e) => toast.error("The pages could not be added", e));
          }}
        />
      )}
      <ImportPresentationDialog
        open={importing}
        onClose={() => setImporting(false)}
        onAdd={(item, message, detail) => {
          setImporting(false);
          void live
            .addItem({ ...item, id: newId() })
            .then(() => toast.success(message, detail))
            .catch((e) => toast.error("The item could not be added to the lineup", e));
        }}
      />

      {live.recoveredAt && !showHome && (
        <div className="flex items-center gap-3 border-b border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          <History className="size-4 text-primary" />
          <span className="flex-1">
            Your presentation from {timeAgo(live.recoveredAt)} was restored{live.serviceTitle ? ` (“${live.serviceTitle}”)` : ""}.
            {!projector.open && " Press Go Live to continue where you left off."}
          </span>
          <IconButton size="sm" label="Dismiss" icon={<X className="size-3.5" />} onClick={live.dismissRecovery} />
        </div>
      )}

      {showHome ? (
        <>
          <LiveHome onOpen={() => setBrowsing(false)} onBack={browsing && live.serviceId ? () => setBrowsing(false) : undefined} />
          <QuickPresentBar />
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Lineup */}
          <div className="flex w-72 shrink-0 flex-col border-r border-border">
            <LiveLineup onImport={() => setImporting(true)} />
          </div>

          {/* The selected item's slides, or a Bible chapter */}
          <div className="flex min-w-0 flex-1 flex-col">
            {lockedItem && (
              <div className="flex flex-wrap items-center gap-2 border-b border-primary/40 bg-primary/10 px-4 py-1.5 text-xs" role="status">
                <Lock className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <strong>Output locked</strong> on “{lockedItem.title}”. What you choose now is prepared, not shown.
                </span>
                {cueLabel && (
                  <button type="button" onClick={live.showCue} className="max-w-72 shrink-0 truncate rounded-md bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-hover">
                    Show “{cueLabel}” now
                  </button>
                )}
                <button type="button" onClick={() => live.setLocked(false)} className="shrink-0 font-semibold text-accent hover:underline">
                  Unlock
                </button>
              </div>
            )}
            {showBible ? (
              <div className="min-h-0 flex-1">
                <BibleChapter />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                  <p className="min-w-40 flex-1 truncate text-sm font-semibold">{selectedItem?.title ?? "Slides"}</p>
                  {selectedItem?.error && <span className="max-w-64 truncate text-xs text-warning">{selectedItem.error}</span>}
                  {selectedItem && selectedItem.type !== "heading" && (
                    <Select
                      aria-label="Theme for this item"
                      title="Give this item its own theme. You can also drag a theme from the palette onto it."
                      className="h-8 w-48 text-xs"
                      value={ownThemeId ?? ""}
                      onChange={(e) => void live.setItemTheme(selectedItem.id, e.target.value || null).catch((err) => toast.error("The theme could not be applied", err))}
                    >
                      <option value="">Item theme: as planned</option>
                      {themes.data?.map((t) => (
                        <option key={t.id} value={t.id}>
                          Item theme: {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  {selectedItem && canva && !canva.brought && (
                    <CanvaPageCount
                      compact
                      value={canvaPagesOf(source?.settings ?? {})}
                      onChange={(n) =>
                        void live
                          .updateItem(selectedItem.id, (i) => ({ ...i, settings: { ...i.settings, canvaPages: n } }))
                          .catch((e) => toast.error("The page count could not be saved", e))
                      }
                    />
                  )}
                  {selectedItem && canva && (
                    <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-elevated px-2.5 text-xs font-medium hover:bg-hover" onClick={() => setCanvaPages(true)}>
                      <Globe className="size-3.5" /> {canva.brought ? "Update from Canva…" : "Show every page…"}
                    </button>
                  )}
                  {liveCanva && <CanvaPicturesControl itemId={liveCanva.id} onTake={takePictures} />}
                  {selectedItem && selectedItem.type !== "heading" && (
                    <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-elevated px-2.5 text-xs font-medium hover:bg-hover" onClick={() => useThemeEditor.getState().open(selectedItem.id)}>
                      <Paintbrush className="size-3.5" /> Customize…
                    </button>
                  )}
                  <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Slide view">
                    <IconButton size="sm" label="Grid view" icon={<LayoutGrid className="size-4" />} active={slideView === "grid"} onClick={() => setSlideView("grid")} />
                    <IconButton size="sm" label="List view" icon={<List className="size-4" />} active={slideView === "list"} onClick={() => setSlideView("list")} />
                  </div>
                </div>
                {selectedItem && canva && !canva.brought && canvaPagesOf(source?.settings ?? {}) <= 1 && (
                  <div className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm" role="status">
                    <Globe className="size-4 shrink-0 text-warning" />
                    <span className="min-w-0 flex-1">
                      <strong>How many pages does this Canva design have?</strong> Canva shows it at the bottom of the design, for example “1 / 34”. Type it here, then Next
                      and the arrow keys turn its pages.
                    </span>
                    <CanvaPageCount
                      compact
                      value={canvaPagesOf(source?.settings ?? {})}
                      onChange={(n) =>
                        void live
                          .updateItem(selectedItem.id, (i) => ({ ...i, settings: { ...i.settings, canvaPages: n } }))
                          .then(() => toast.success(`“${selectedItem.title}” now has ${n} pages`))
                          .catch((e) => toast.error("The page count could not be saved", e))
                      }
                    />
                  </div>
                )}
                {engine.output === "clear" && (
                  <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs" role="status">
                    <Eraser className="size-3.5 shrink-0 text-warning" />
                    <span>
                      <strong>Clear is on:</strong> slides you choose show only their background until you press Clear again.
                    </span>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-4 [scroll-padding-top:3.5rem]">
                  {selectedItem ? (
                    selectedItem.slides.length ? (
                      <LiveSlides
                        slides={selectedItem.slides}
                        view={slideView}
                        theme={itemTheme(live, live.themeOverrideId ?? selectedItem.themeId)}
                        media={live.media}
                        aspect={aspect}
                        liveIndex={selectedIsLive ? engine.live!.slideIndex : cueIndex}
                        nextId={next?.id ?? null}
                        onAir={projector.open && selectedIsLive}
                        onPick={(si) => live.dispatch({ type: "goLive", itemIndex: selectedIndex!, slideIndex: si })}
                      />
                    ) : (
                      <EmptyState title={selectedItem.error ?? "This item has no slides"} />
                    )
                  ) : (
                    <EmptyState icon={<MonitorPlay />} title="Select an item" description="Click a slide to put it on the screen. Use → / Space for the next slide and ← for the previous one." />
                  )}
                </div>
              </>
            )}
            <QuickPresentBar />
          </div>

          {/* Program & controls */}
          <div className="flex w-[440px] shrink-0 flex-col border-l border-border bg-panel">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold tracking-wide">
                    <span className="relative flex size-2.5" aria-hidden>
                      {projector.open && <span className="absolute inline-flex size-full rounded-full bg-live/70 motion-safe:animate-ping" />}
                      <span className={cn("relative inline-flex size-2.5 rounded-full transition-colors", projector.open ? "bg-live" : "bg-subtle")} />
                    </span>
                    {projector.open ? "LIVE OUTPUT" : "PREVIEW (output off)"}
                    {lockedItem && (
                      <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                        <Lock className="size-3" /> LOCKED
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-subtle">{positionLabel(engine) ?? ""}</span>
                </div>
                <div className={cn("relative overflow-hidden rounded-xl border-2 shadow-sm", projector.open && engine.output === "normal" && engine.live ? "border-live" : "border-border")} style={{ aspectRatio: aspect }}>
                  <SlideRenderer
                    content={render.slide?.content ?? null}
                    slideKey={render.slide?.id ?? null}
                    theme={render.theme}
                    output={render.output}
                    media={render.media}
                    logo={render.logo}
                    logoScreen={render.logoScreen ?? null}
                    fadeMs={render.fadeMs ?? 0}
                    music={render.music ?? null}
                    musicStatus={live.musicStatus}
                    embeds
                    churchName={render.churchName}
                    aspect={aspect}
                    className="absolute inset-0 overflow-hidden"
                  />
                  {engine.output !== "normal" && engine.live && (
                    <span className="absolute top-2 right-2 rounded bg-warning px-2 py-0.5 text-[11px] font-bold text-black uppercase">{engine.output}</span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted">{current && liveItem ? `${liveItem.title} — ${current.label}` : "Nothing on screen"}</p>
              </div>

              <OutputControls shortcuts={shortcuts} />

              <MusicControls />

              {isVideo && (
                <div className="rounded-xl border border-border bg-bg p-2">
                  <div className="flex items-center gap-2">
                    <Film className="size-4 text-primary" />
                    <IconButton size="sm" label="Play" icon={<Play className="size-4" />} onClick={() => live.mediaControl("play")} />
                    <IconButton size="sm" label="Pause" icon={<Pause className="size-4" />} onClick={() => live.mediaControl("pause")} />
                    <IconButton size="sm" label="Restart" icon={<RotateCcw className="size-4" />} onClick={() => live.mediaControl("restart")} />
                    <span className="ml-auto text-xs text-muted">
                      {live.mediaStatus ? `${formatDuration(live.mediaStatus.currentTime)} / ${formatDuration(live.mediaStatus.duration)}` : projector.open ? "Starting…" : "Go Live to play"}
                    </span>
                  </div>
                  {live.mediaStatus && live.mediaStatus.duration > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded bg-elevated">
                      <div className="h-full bg-primary" style={{ width: `${(100 * live.mediaStatus.currentTime) / live.mediaStatus.duration}%` }} />
                    </div>
                  )}
                  {live.mediaStatus?.error && <p className="mt-2 text-xs text-danger">{live.mediaStatus.error}</p>}
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-subtle">NEXT</p>
                <div className="flex gap-3">
                  <div className="relative w-44 shrink-0 overflow-hidden rounded-lg border border-border" style={{ aspectRatio: aspect }}>
                    {next ? (
                      <SlideRenderer
                        content={next.content}
                        slideKey={next.id}
                        theme={itemTheme(live, live.themeOverrideId ?? nextItem?.themeId)}
                        output="normal"
                        media={live.media}
                        logo={null}
                        aspect={aspect}
                        className="absolute inset-0 overflow-hidden"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-bg text-xs text-subtle">End</div>
                    )}
                  </div>
                  <div className="min-w-0 text-xs text-muted">
                    {next ? (
                      <>
                        <p className="truncate text-text">{nextItem && !isBibleNow(nextItem.id) ? nextItem.title : "Bible"}</p>
                        <p className="truncate">{next.label}</p>
                      </>
                    ) : liveItem && isBibleNow(liveItem.id) ? (
                      <span>Next shows the following verse.</span>
                    ) : engine.live && !live.options.advanceAcrossItems && engine.live.itemIndex < engine.items.length - 1 ? (
                      <span>
                        <span className="text-text">End of “{liveItem?.title}”.</span> Click the next item in the lineup to continue.
                      </span>
                    ) : (
                      "No more slides"
                    )}
                  </div>
                </div>
              </div>

              {current?.notes && (
                <div className="rounded-xl border border-border bg-bg p-2 text-xs text-muted">
                  <p className="mb-1 font-semibold text-subtle">Notes</p>
                  <p className="whitespace-pre-wrap selectable">{current.notes}</p>
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 text-[11px] text-subtle">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <Kbd>{comboLabel(shortcuts.next[0] ?? "ArrowRight")}</Kbd> next
                </span>
                <span>
                  <Kbd>{comboLabel(shortcuts.previous[0] ?? "ArrowLeft")}</Kbd> previous
                </span>
                <span>
                  <Kbd>{comboLabel(shortcuts.blank[0] ?? "KeyB")}</Kbd> black
                </span>
                <span>
                  <Kbd>{comboLabel(shortcuts.first[0] ?? "Home")}</Kbd>/<Kbd>{comboLabel(shortcuts.last[0] ?? "End")}</Kbd> first/last
                </span>
                <span>
                  <Kbd>{comboLabel(shortcuts.exit[0] ?? "Escape")}</Kbd> stop
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Previous / Next, and what the screen shows: Black, Clear, Logo, Stop. */
function OutputControls({ shortcuts }: { shortcuts: ShortcutMap }) {
  const live = useLive();
  const output = live.engine.output;
  return (
    <div className="rounded-2xl border border-border bg-bg/60 p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => live.shortcut("previous")}
          title={shortcuts.previous[0] ? `Previous (${comboLabel(shortcuts.previous[0])})` : undefined}
          className="flex h-14 items-center justify-center gap-2 rounded-xl border border-border bg-panel text-base font-semibold text-text shadow-sm transition hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98]"
        >
          <ChevronLeft className="size-5 text-primary" /> Previous
        </button>
        <button
          type="button"
          onClick={() => live.shortcut("next")}
          title={shortcuts.next[0] ? `Next (${comboLabel(shortcuts.next[0])})` : undefined}
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#d9b25c,#b0842a_55%,#8a6417)] text-base font-semibold text-white shadow-[0_6px_16px_-6px_rgb(176_132_42/0.85)] transition hover:brightness-110 active:scale-[0.98]"
        >
          Next <ChevronRight className="size-5" />
        </button>
      </div>
      <LockButton />
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <ModeTile label="Black" shortcut={shortcuts.blank[0]} active={output === "black"} icon={<Square className="fill-current" />} onClick={() => live.dispatch({ type: "toggleOutput", output: "black" })} />
        <ModeTile label="Clear" shortcut={shortcuts.clear[0]} active={output === "clear"} icon={<Eraser />} onClick={() => live.dispatch({ type: "toggleOutput", output: "clear" })} />
        <ModeTile label="Logo" shortcut={shortcuts.logo[0]} active={output === "logo"} icon={<Sparkles />} onClick={() => live.dispatch({ type: "toggleOutput", output: "logo" })} />
        <ModeTile label="Stop" shortcut={shortcuts.exit[0]} active={false} danger icon={<X />} onClick={() => live.dispatch({ type: "stop" })} />
      </div>
    </div>
  );
}

/** Keeps the item on screen while the operator prepares other things (Present now, other items). */
function LockButton() {
  const live = useLive();
  const item = lockedItemOf(live);
  const locked = !!live.locked;
  const canLock = live.projector.open && !!live.engine.live;
  return (
    <button
      type="button"
      aria-pressed={locked}
      aria-label={locked ? `Locked on “${item?.title ?? ""}” (press to unlock)` : "Lock output"}
      disabled={!locked && !canLock}
      onClick={() => live.setLocked(!locked)}
      title={locked ? "Unlock: what you choose shows on screen again" : "Keep this item on screen while you prepare other things"}
      className={cn(
        "mt-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
        locked ? "border-primary bg-primary/15 text-text ring-1 ring-primary/40" : "border-border bg-panel text-muted hover:border-primary/50 hover:text-text",
      )}
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4", locked ? "bg-primary text-white" : "bg-elevated text-primary")}>
        {locked ? <Lock /> : <LockOpen />}
      </span>
      <span className="min-w-0 flex-1 truncate">{locked ? `Locked on “${item?.title ?? ""}”` : "Lock output"}</span>
      <span aria-hidden className="shrink-0 text-xs font-medium text-subtle">
        {locked ? "Unlock" : canLock ? "Prepare freely" : "Go Live first"}
      </span>
    </button>
  );
}

/** The item the output is locked on. */
function lockedItemOf(live: ReturnType<typeof useLive.getState>) {
  return live.locked ? live.engine.items.find((i) => i.id === live.locked) : null;
}

function ModeTile({ label, shortcut, active, danger, icon, onClick }: { label: string; shortcut?: string; active: boolean; danger?: boolean; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={danger ? undefined : active}
      onClick={onClick}
      title={shortcut ? `${label} (${comboLabel(shortcut)})` : label}
      className={cn(
        "group flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold transition active:scale-[0.97]",
        active ? "border-primary bg-primary/15 text-text ring-1 ring-primary/40" : "border-border bg-panel text-muted hover:border-primary/40 hover:text-text",
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors [&>svg]:size-4",
          active ? "bg-primary text-white" : danger ? "bg-elevated text-danger group-hover:bg-danger/10" : "bg-elevated text-primary group-hover:bg-primary/15",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
