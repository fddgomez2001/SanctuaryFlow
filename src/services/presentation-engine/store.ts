/**
 * Operator-side live presentation store. It owns navigation (pure engine),
 * resolves service items into slides, and publishes a self-contained render
 * state to the projector window through local Tauri events. Nothing here
 * touches the network, and slide changes never wait for storage.
 */
import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ServiceItem } from "@/types/generated/ServiceItem";
import type { ServiceItemInput } from "@/types/generated/ServiceItemInput";
import { queryClient } from "@/app/queryClient";
import { planToDocument } from "@/features/services/model";
import { api, type DisplayInfo, type ProjectorMode, type ProjectorStatus, type SettingsMap } from "@/services/api";
import { setting } from "@/hooks/useSettings";
import { DEFAULT_THEME, normalizeTheme, themeMediaIds, type ThemeSettings } from "@/lib/theme";
import { deckSlideMediaIds } from "@/lib/slides/deck";
import type { Slide } from "@/lib/slides/types";
import { errorMessage } from "@/lib/ipc";
import { eventToCombo, matchShortcut, normalizeShortcuts, type ShortcutAction } from "@/lib/keyboard";
import { canonBook } from "@/lib/bible/canon";
import { formatReference } from "@/lib/bible/reference";
import { scriptureSettings } from "@/lib/service-items";
import { logoBackground, logoScreenMediaIds, logoScreenSettings, outputFadeMs } from "@/lib/logo-screen";
import {
  applyOrder,
  currentItem,
  currentSlide,
  type EngineAction,
  type EngineOptions,
  type EngineState,
  initialState,
  type LivePosition,
  type OutputMode,
  reduce,
} from "./engine";
import { loadThemes, resolveItems } from "./resolve";
import { resolveMedia } from "./media";
import { onSongChanged } from "@/lib/library-events";
import { DEFAULT_ALBUM_REF } from "@/lib/default-art";
import type {
  MediaCommand,
  MediaRef,
  MusicCommand,
  MusicRender,
  MusicView,
  ProjectorMediaStatus,
  ProjectorMusicStatus,
  ProjectorRenderState,
  ProjectorReport,
} from "./render-model";
import type { TextAlign } from "@/lib/theme";

interface Session {
  serviceId: string | null;
  adhoc: ServiceItem[];
  liveItemId: string | null;
  liveSlideIndex: number;
  output: OutputMode;
  itemOrder?: string[] | null;
  savedAt: string;
}

export interface LiveState {
  ready: boolean;
  engine: EngineState;
  options: EngineOptions;
  serviceId: string | null;
  serviceTitle: string | null;
  planThemeId: string | null;
  serviceItems: ServiceItem[];
  adhocItems: ServiceItem[];
  media: Record<string, MediaRef>;
  themes: Map<string, ThemeSettings>;
  settings: SettingsMap | undefined;
  loading: boolean;
  loadError: string | null;
  displays: DisplayInfo[];
  projector: ProjectorStatus;
  projectorReady: boolean;
  mediaStatus: ProjectorMediaStatus | null;
  mediaCommand: MediaCommand | null;
  publishError: string | null;
  recoveredAt: string | null;
  /** Temporary theme for everything on the output, chosen during the service. */
  themeOverrideId: string | null;
  /** Item ids in the order the operator arranged them (null: plan order, then items added live). */
  itemOrder: string[] | null;
  /** How the live song's music is shown, and the last player command. */
  musicView: MusicView;
  musicCommand: MusicCommand | null;
  musicStatus: ProjectorMusicStatus | null;

  init: () => Promise<void>;
  setSettings: (s: SettingsMap | undefined) => void;
  refreshThemes: () => Promise<void>;
  loadService: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  present: (item: ServiceItem, goLive?: boolean) => Promise<void>;
  removeAdhoc: (id: string) => Promise<void>;
  dispatch: (a: EngineAction) => void;
  shortcut: (action: ShortcutAction) => void;
  mediaControl: (action: MediaCommand["action"]) => void;
  openProjector: (displayId?: string | null, mode?: ProjectorMode) => Promise<void>;
  closeProjector: () => Promise<void>;
  dismissRecovery: () => void;
  setThemeOverride: (id: string | null) => Promise<void>;
  /** Moves items in the lineup; service items are saved in the new order. */
  reorderItems: (ids: string[]) => Promise<void>;
  /** Adds an item to the lineup: saved into the loaded service, or added live without one. */
  addItem: (item: ServiceItem) => Promise<void>;
  /** Changes one lineup item (saved into the service, or kept with the items added live). */
  updateItem: (itemId: string, change: <T extends ServiceItemInput>(item: T) => T) => Promise<void>;
  /** Plays, pauses, seeks (seconds), or sets speed or volume of the live song's music. */
  musicControl: (action: MusicCommand["action"], value?: number) => void;
  setMusicView: (view: MusicView) => void;
  /** Gives one item its own theme (null returns it to the planned theme). */
  setItemTheme: (itemId: string, themeId: string | null) => Promise<void>;
  /**
   * Shows a Scripture passage chosen in the Bible view (Present now) without
   * adding it to the lineup; it replaces the passage shown that way before.
   */
  presentBible: (item: ServiceItem, opts?: { followLock?: boolean }) => Promise<void>;
  /** Lets Next/Previous do something else first (the Bible view steps verse by verse); true when handled. */
  stepHook: ((direction: 1 | -1) => boolean) | null;
  /**
   * The item the output is locked on: while set, nothing else reaches the
   * screen (Present now, other items' slides, jumps); they are only prepared.
   * Next/Previous within the item, Black, Clear and Logo still work.
   */
  locked: string | null;
  /** A slide chosen while locked, shown on screen once unlocked ("Show it now"). */
  cue: { itemId: string; slideIndex: number } | null;
  setLocked: (on: boolean) => void;
  /** Unlocks and shows the prepared slide. */
  showCue: () => void;
}

/** Items shown from the Bible view have ids starting with this; they are not listed in the lineup. */
export const BIBLE_NOW_PREFIX = "bible-now:";
export const isBibleNow = (id: string | null | undefined): boolean => !!id && id.startsWith(BIBLE_NOW_PREFIX);

const closedProjector: ProjectorStatus = { open: false, visible: false, mode: null, displayId: null, waitingForDisplay: false };

let seq = 0;
let resolveGeneration = 0;
let bibleGeneration = 0;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
const unlisteners: UnlistenFn[] = [];
const recordedUse = new Set<string>();

function themeFor(s: LiveState, themeId: string | null | undefined): ThemeSettings {
  const fallbackId = setting<string | null>(s.settings, "presentation.defaultSongThemeId", null);
  return (themeId && s.themes.get(themeId)) || (fallbackId && s.themes.get(fallbackId)) || DEFAULT_THEME;
}

/** Output aspect ratio from the projector (or chosen) display. */
function outputAspect(s: LiveState): number {
  const id = s.projector.displayId ?? setting<string | null>(s.settings, "presentation.outputDisplay", null);
  const d = s.displays.find((x) => x.id === id) ?? s.displays.find((x) => !x.isPrimary) ?? s.displays[0];
  return d && d.height > 0 ? d.width / d.height : 16 / 9;
}

function slideMediaIds(slide: Slide | null): string[] {
  if (!slide) return [];
  if (slide.content.kind === "media") return [slide.content.mediaId];
  if (slide.content.kind === "custom") return deckSlideMediaIds(slide.content.slide);
  return [];
}

/** Builds the projector state for the current position. */
/** The live song's music as the output needs it, or null. */
function musicRender(s: LiveState): MusicRender | null {
  const item = currentItem(s.engine);
  const m = item?.music;
  const audio = m ? s.media[m.audioMediaId] : undefined;
  if (!m || !audio) return null;
  return {
    songId: m.songId,
    audio,
    cover: (m.coverMediaId && s.media[m.coverMediaId]) || DEFAULT_ALBUM_REF,
    title: m.title,
    artist: m.artist,
    lines: m.lines,
    view: s.musicView,
    fontSize: setting(s.settings, "music.fontSize", 64),
    align: setting<TextAlign>(s.settings, "music.align", "center"),
    command: s.musicCommand,
  };
}

export function buildRenderState(s: LiveState): ProjectorRenderState {
  const slide = currentSlide(s.engine);
  const item = currentItem(s.engine);
  const chosen = themeFor(s, s.themeOverrideId ?? item?.themeId);
  // A passage from the Bible view always shows its reference ("John 3:16").
  const theme = item && isBibleNow(item.id) && !chosen.reference.show ? { ...chosen, reference: { ...chosen.reference, show: true } } : chosen;
  const screen = logoScreenSettings(s.settings);
  const ids = [...themeMediaIds(theme), ...slideMediaIds(slide), ...logoScreenMediaIds(screen)];
  const media: Record<string, MediaRef> = {};
  for (const id of ids) {
    const ref = s.media[id];
    if (ref) media[id] = ref;
  }
  const logo = (screen.logoMediaId && s.media[screen.logoMediaId]) || null;
  const strippedSlide = slide ? { id: slide.id, itemId: slide.itemId, label: slide.label, content: slide.content } : null;
  return {
    version: 1,
    seq: ++seq,
    // Nothing live shows black rather than a stray background.
    output: s.engine.live ? s.engine.output : s.engine.output === "logo" ? "logo" : "black",
    slide: strippedSlide,
    theme,
    media,
    logo,
    logoScreen: { logo, background: logoBackground(screen.background), size: screen.size, sound: screen.sound },
    fadeMs: outputFadeMs(s.settings),
    music: musicRender(s),
    churchName: setting(s.settings, "general.churchName", ""),
    aspect: outputAspect(s),
    mediaCommand: s.mediaCommand,
  };
}

export const useLive = create<LiveState>((set, get) => {
  const publish = () => {
    const s = get();
    api.presentation.update(buildRenderState(s)).then(
      () => s.publishError && set({ publishError: null }),
      (e) => set({ publishError: errorMessage(e) }),
    );
    scheduleSession();
    recordUsage();
  };

  const scheduleSession = () => {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      const s = get();
      const item = currentItem(s.engine);
      const session: Session = {
        serviceId: s.serviceId,
        adhoc: s.adhocItems,
        liveItemId: item?.id ?? null,
        liveSlideIndex: s.engine.live?.slideIndex ?? 0,
        output: s.engine.output,
        itemOrder: s.itemOrder,
        savedAt: new Date().toISOString(),
      };
      void api.presentation.saveSession(session).catch(() => undefined);
    }, 400);
  };

  /** Records which songs and passages were actually presented. */
  const recordUsage = () => {
    const s = get();
    const item = currentItem(s.engine);
    if (!item || !s.engine.live || recordedUse.has(item.id)) return;
    const source = [...s.serviceItems, ...s.adhocItems].find((i) => i.id === item.id);
    if (!source) return;
    recordedUse.add(item.id);
    if (source.itemType === "song" && source.refId) void api.songs.recordUse(source.refId).catch(() => undefined);
    if (source.itemType === "scripture") {
      const sc = scriptureSettings(source.settings ?? {});
      for (const ref of sc.references) {
        const name = canonBook(ref.bookId)?.name ?? ref.bookId;
        void api.bible
          .recordUse({ reference: formatReference(name, ref), translationId: sc.translationId ?? null, passage: ref })
          .catch(() => undefined);
      }
    }
  };

  const resolveAll = async (restore?: { itemId: string | null; slideIndex: number; output: OutputMode }) => {
    const generation = ++resolveGeneration;
    const s = get();
    set({ loading: true, loadError: null });
    try {
      const { items, media } = await resolveItems(applyOrder([...s.serviceItems, ...s.adhocItems], s.itemOrder), {
        settings: s.settings,
        planThemeId: s.planThemeId,
        themes: s.themes,
      });
      if (generation !== resolveGeneration) return;
      // The output theme chosen during the service is not part of any item,
      // so its background/logo media must be kept alongside the items' media.
      const overrideId = get().themeOverrideId;
      const override = overrideId ? get().themes.get(overrideId) : undefined;
      const extraIds = override ? themeMediaIds(override).filter((id) => !media[id]) : [];
      if (extraIds.length) Object.assign(media, (await resolveMedia(extraIds)).refs);
      if (generation !== resolveGeneration) return;
      let engine = reduce(get().engine, { type: "setItems", items }, get().options);
      if (restore?.itemId) {
        const idx = items.findIndex((i) => i.id === restore.itemId);
        if (idx >= 0 && items[idx]!.slides.length) {
          engine = reduce(engine, { type: "goLive", itemIndex: idx, slideIndex: Math.min(restore.slideIndex, items[idx]!.slides.length - 1) }, get().options);
          engine = { ...engine, output: restore.output };
        }
      }
      // A lock on an item that is gone (another service opened) is released.
      const lock = get().locked;
      set({ engine, media, loading: false, ...(lock && !items.some((i) => i.id === lock) ? { locked: null, cue: null } : {}) });
      publish();
    } catch (e) {
      if (generation === resolveGeneration) set({ loading: false, loadError: errorMessage(e) });
    }
  };

  /** Applies a change to the loaded service plan and saves it. */
  const savePlan = async (change: (items: ServiceItemInput[]) => ServiceItemInput[]) => {
    const id = get().serviceId;
    if (!id) return;
    const doc = planToDocument(await api.services.get(id));
    const saved = await api.services.save({ ...doc, items: change(doc.items) });
    queryClient.setQueryData(["service", id], saved);
    void queryClient.invalidateQueries({ queryKey: ["services"] });
    if (get().serviceId === id) set({ serviceItems: saved.items, planThemeId: saved.themeId, serviceTitle: saved.title });
  };

  const handleProjectorReport = (report: ProjectorReport) => {
    if (report.type === "ready") {
      set({ projectorReady: true });
      publish();
    } else if (report.type === "media") {
      set({ mediaStatus: report });
    } else if (report.type === "music") {
      set({ musicStatus: report });
    }
  };

  return {
    ready: false,
    engine: initialState,
    options: { advanceAcrossItems: false },
    serviceId: null,
    serviceTitle: null,
    planThemeId: null,
    serviceItems: [],
    adhocItems: [],
    media: {},
    themes: new Map(),
    settings: undefined,
    loading: false,
    loadError: null,
    displays: [],
    projector: closedProjector,
    projectorReady: false,
    mediaStatus: null,
    mediaCommand: null,
    publishError: null,
    recoveredAt: null,
    themeOverrideId: null,
    itemOrder: null,
    musicView: "slides",
    musicCommand: null,
    musicStatus: null,
    stepHook: null,
    locked: null,
    cue: null,

    async init() {
      if (get().ready) return;
      set({ ready: true });
      const [settings, themes, displays, projector, recovery] = await Promise.all([
        api.settings.all().catch(() => undefined),
        loadThemes().catch(() => new Map<string, ThemeSettings>()),
        api.presentation.displays().catch(() => []),
        api.presentation.projectorStatus().catch(() => closedProjector),
        api.presentation.recovery().catch(() => null),
      ]);
      set({
        settings,
        themes,
        displays,
        projector,
        options: { advanceAcrossItems: setting(settings, "presentation.advanceAcrossItems", false) },
      });

      unlisteners.push(
        await listen<ProjectorStatus>("projector://changed", (e) => set({ projector: e.payload, ...(e.payload.open ? {} : { projectorReady: false }) })),
        await listen<DisplayInfo[]>("displays://changed", (e) => set({ displays: e.payload })),
        await listen<ProjectorReport>("projector://status", (e) => handleProjectorReport(e.payload)),
        await listen<{ code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }>("projector://key", (e) => {
          const action = matchShortcut(normalizeShortcuts(get().settings?.["keyboard.shortcuts"]), eventToCombo(e.payload));
          if (action) get().shortcut(action);
        }),
        await listen("library://restored", () => {
          void get().refreshThemes().then(() => get().refresh());
        }),
        // A song edited in the Song Library updates its slides here and on the output.
        onSongChanged((songId) => {
          const s = get();
          if ([...s.serviceItems, ...s.adhocItems].some((i) => i.itemType === "song" && i.refId === songId)) void resolveAll();
        }),
      );

      // Recover the last presentation after a restart or crash.
      const session = recovery?.session as Session | null | undefined;
      if (session && (session.serviceId || session.adhoc?.length)) {
        set({
          adhocItems: Array.isArray(session.adhoc) ? session.adhoc : [],
          itemOrder: Array.isArray(session.itemOrder) ? session.itemOrder.filter((x): x is string => typeof x === "string") : null,
          recoveredAt: session.savedAt ?? null,
        });
        if (session.serviceId) {
          try {
            const plan = await api.services.get(session.serviceId);
            set({ serviceId: plan.id, serviceTitle: plan.title, planThemeId: plan.themeId, serviceItems: plan.items });
          } catch {
            set({ serviceId: null });
          }
        }
        await resolveAll({ itemId: session.liveItemId, slideIndex: session.liveSlideIndex ?? 0, output: session.output ?? "normal" });
      } else {
        publish();
      }
    },

    setSettings(settings) {
      if (!settings) return;
      set({ settings, options: { advanceAcrossItems: setting(settings, "presentation.advanceAcrossItems", false) } });
      // A newly chosen logo or logo background must reach the output too.
      const missing = logoScreenMediaIds(logoScreenSettings(settings)).filter((id) => !get().media[id]);
      if (missing.length) {
        void resolveMedia(missing).then(({ refs }) => {
          set({ media: { ...get().media, ...refs } });
          publish();
        });
      } else if (get().ready) {
        publish();
      }
    },

    async refreshThemes() {
      const themes = await loadThemes();
      set({ themes });
      const s = get();
      const ids = [...themes.values()].flatMap(themeMediaIds).filter((id) => !s.media[id]);
      if (ids.length) {
        const { refs } = await resolveMedia(ids);
        set({ media: { ...get().media, ...refs } });
      }
      publish();
    },

    async loadService(id) {
      recordedUse.clear();
      if (id !== get().serviceId) set({ itemOrder: null });
      if (!id) {
        set({ serviceId: null, serviceTitle: null, planThemeId: null, serviceItems: [], engine: reduce(get().engine, { type: "setItems", items: [] }, get().options) });
        await resolveAll();
        return;
      }
      set({ loading: true });
      try {
        const plan = await api.services.get(id);
        void api.services.markOpened(id).catch(() => undefined);
        set({ serviceId: plan.id, serviceTitle: plan.title, planThemeId: plan.themeId, serviceItems: plan.items });
        await resolveAll();
      } catch (e) {
        set({ loading: false, loadError: errorMessage(e) });
      }
    },

    async refresh() {
      const id = get().serviceId;
      if (id) {
        try {
          const plan = await api.services.get(id);
          set({ serviceTitle: plan.title, planThemeId: plan.themeId, serviceItems: plan.items });
        } catch {
          // The service was deleted; keep presenting what is already loaded.
        }
      }
      await resolveAll();
    },

    async present(item, goLive = true) {
      const order = get().itemOrder;
      set({
        adhocItems: [...get().adhocItems.filter((i) => i.id !== item.id), item],
        // Something added live goes to the end of an arranged lineup.
        ...(order ? { itemOrder: [...order.filter((id) => id !== item.id), item.id] } : {}),
      });
      await resolveAll();
      if (goLive) {
        const s = get();
        const idx = s.engine.items.findIndex((i) => i.id === item.id);
        if (idx >= 0 && s.engine.items[idx]!.slides.length) get().dispatch({ type: "goLive", itemIndex: idx, slideIndex: 0 });
        else if (idx >= 0) get().dispatch({ type: "select", itemIndex: idx });
      }
    },

    async removeAdhoc(id) {
      set({ adhocItems: get().adhocItems.filter((i) => i.id !== id) });
      await resolveAll();
    },

    dispatch(a) {
      const before = get().engine;
      let engine = reduce(before, a, get().options);
      if (engine === before) return;
      if (a.type === "stop" && get().locked) set({ locked: null, cue: null });
      // Locked: another item may be chosen and prepared, but the screen keeps the locked item.
      const locked = get().locked;
      const target = currentItem(engine);
      if (locked && engine.live && target && target.id !== locked) {
        set({ cue: { itemId: target.id, slideIndex: engine.live.slideIndex } });
        engine = { ...before, selectedItemIndex: engine.live.itemIndex };
        if (engine.selectedItemIndex === before.selectedItemIndex) return;
        set({ engine });
        return;
      }
      // Moving through the locked item leaves the operator where they are preparing.
      if (locked && (a.type === "next" || a.type === "previous" || a.type === "first" || a.type === "last") && before.selectedItemIndex != null) {
        engine = { ...engine, selectedItemIndex: before.selectedItemIndex };
      }
      const slideChanged = currentSlide(engine)?.id !== currentSlide(before)?.id;
      // Another item on screen: its music starts again from the slides view.
      const itemChanged = currentItem(engine)?.id !== currentItem(before)?.id;
      set({
        engine,
        ...(slideChanged ? { mediaCommand: null, mediaStatus: null } : {}),
        ...(itemChanged ? { musicView: "slides" as MusicView, musicCommand: null, musicStatus: null } : {}),
      });
      publish();
    },

    shortcut(action) {
      const d = get().dispatch;
      // Staying within each item, ↓ and ↑ step through its slides like → and ←
      // instead of jumping to another item.
      if (!get().options.advanceAcrossItems) {
        if (action === "nextItem") action = "next";
        else if (action === "previousItem") action = "previous";
      }
      if ((action === "next" || action === "previous") && get().stepHook?.(action === "next" ? 1 : -1)) return;
      switch (action) {
        case "next":
        case "previous":
        case "first":
        case "last":
        case "nextItem":
        case "previousItem":
          d({ type: action });
          break;
        case "blank":
          d({ type: "toggleOutput", output: "black" });
          break;
        case "clear":
          d({ type: "toggleOutput", output: "clear" });
          break;
        case "logo":
          d({ type: "toggleOutput", output: "logo" });
          break;
        case "exit":
          // Safe exit: take the content off screen; the output window stays open.
          d({ type: "stop" });
          break;
      }
    },

    musicControl(action, value) {
      const s = get();
      // Playing shows the music view chosen in Settings unless one is already showing.
      if (action === "play" && s.musicView === "slides") set({ musicView: setting<MusicView>(s.settings, "music.defaultView", "vinyl") });
      set({ musicCommand: { seq: Date.now() + Math.random(), action, ...(value !== undefined ? { value } : {}) } });
      publish();
    },

    setMusicView(view) {
      set({ musicView: view });
      publish();
    },

    mediaControl(action) {
      set({ mediaCommand: { seq: Date.now(), action } });
      publish();
    },

    async openProjector(displayId, mode) {
      const s = get();
      const chosen = displayId ?? setting<string | null>(s.settings, "presentation.outputDisplay", null);
      const secondary = s.displays.some((d) => !d.isPrimary);
      const status = await api.presentation.openProjector(chosen, mode ?? (secondary ? "fullscreen" : "window"));
      set({ projector: status });
      publish();
    },

    async closeProjector() {
      await api.presentation.closeProjector();
      // Nothing is on screen any more, so nothing stays locked.
      set({ projector: closedProjector, projectorReady: false, locked: null, cue: null });
    },

    setLocked(on) {
      const item = currentItem(get().engine);
      set(on && item && get().engine.live ? { locked: item.id, cue: null } : { locked: null });
    },

    showCue() {
      const { cue, engine } = get();
      set({ locked: null, cue: null });
      if (!cue) return;
      const index = engine.items.findIndex((i) => i.id === cue.itemId);
      if (index >= 0) get().dispatch({ type: "goLive", itemIndex: index, slideIndex: cue.slideIndex });
    },

    dismissRecovery() {
      set({ recoveredAt: null });
    },

    async reorderItems(ids) {
      const s = get();
      const byId = new Map(s.engine.items.map((i) => [i.id, i]));
      const items = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      if (items.length !== s.engine.items.length) return;
      // The new order shows at once; the live slide stays on screen.
      set({ itemOrder: ids, engine: reduce(s.engine, { type: "setItems", items }, s.options) });
      publish();
      const position = new Map(ids.map((id, i) => [id, i]));
      try {
        await savePlan((planItems) => [...planItems].sort((a, b) => (position.get(a.id ?? "") ?? Infinity) - (position.get(b.id ?? "") ?? Infinity)));
      } catch (e) {
        set({ loadError: `The new order could not be saved to the service: ${errorMessage(e)}` });
      }
    },

    async addItem(item) {
      if (get().serviceId) {
        const { id, itemType, title, refId, settings, notes } = item;
        await savePlan((items) => [...items, { id, itemType, title, refId, settings, notes }]);
        const order = get().itemOrder;
        if (order) set({ itemOrder: [...order, item.id] });
        await resolveAll();
      } else {
        await get().present(item, false);
      }
      const idx = get().engine.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) get().dispatch({ type: "select", itemIndex: idx });
    },

    async updateItem(itemId, change) {
      const s = get();
      if (s.adhocItems.some((i) => i.id === itemId)) {
        set({ adhocItems: s.adhocItems.map((i) => (i.id === itemId ? change(i) : i)) });
      } else if (s.serviceItems.some((i) => i.id === itemId)) {
        await savePlan((items) => items.map((i) => (i.id === itemId ? change(i) : i)));
      } else {
        return;
      }
      await resolveAll();
    },

    async setItemTheme(itemId, themeId) {
      const withTheme = <T extends { settings: Record<string, unknown> }>(i: T): T => {
        const { themeId: _old, ...rest } = i.settings ?? {};
        return { ...i, settings: themeId ? { ...rest, themeId } : rest };
      };
      const s = get();
      if (s.adhocItems.some((i) => i.id === itemId)) {
        set({ adhocItems: s.adhocItems.map((i) => (i.id === itemId ? withTheme(i) : i)) });
      } else if (s.serviceItems.some((i) => i.id === itemId)) {
        await savePlan((items) => items.map((i) => (i.id === itemId ? withTheme(i) : i)));
      } else {
        return;
      }
      await resolveAll();
    },

    async presentBible(item, opts) {
      const generation = ++bibleGeneration;
      const s = get();
      const { items, media } = await resolveItems([item], { settings: s.settings, planThemeId: s.planThemeId, themes: s.themes });
      const resolved = items[0];
      // A later click has already chosen other verses.
      if (!resolved || generation !== bibleGeneration) return;
      const now = get();
      // Next/Previous through a locked passage moves the lock along with it.
      if (opts?.followLock && now.locked && isBibleNow(now.locked)) set({ locked: item.id });
      const lockedNow = get().locked;
      // A passage the output is locked on stays until the lock is released.
      const kept = now.engine.items.filter((i) => !isBibleNow(i.id) || i.id === lockedNow);
      set({
        adhocItems: [...now.adhocItems.filter((i) => !isBibleNow(i.id) || i.id === lockedNow), item],
        itemOrder: now.itemOrder ? [...now.itemOrder.filter((id) => !isBibleNow(id) || id === lockedNow), item.id] : null,
        media: { ...now.media, ...media },
        engine: reduce(now.engine, { type: "setItems", items: [...kept, resolved] }, now.options),
      });
      if (resolved.slides.length) get().dispatch({ type: "goLive", itemIndex: kept.length, slideIndex: 0 });
      else get().dispatch({ type: "select", itemIndex: kept.length });
      if (resolved.error) throw new Error(resolved.error);
    },

    async setThemeOverride(id) {
      const theme = id ? get().themes.get(id) : undefined;
      const missing = theme ? themeMediaIds(theme).filter((m) => !get().media[m]) : [];
      if (missing.length) {
        const { refs } = await resolveMedia(missing);
        set({ media: { ...get().media, ...refs } });
      }
      set({ themeOverrideId: id && theme ? id : null });
      publish();
    },
  };
});

/** The position currently on screen, for UI highlighting. */
export function livePosition(s: LiveState): LivePosition | null {
  return s.engine.live;
}

export function itemTheme(s: LiveState, themeId: string | null | undefined): ThemeSettings {
  return themeFor(s, themeId);
}

export { normalizeTheme };
