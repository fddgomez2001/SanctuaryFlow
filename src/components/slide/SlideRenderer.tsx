import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DeckSlide, SlideContent, SlideElement } from "@/lib/slides/types";
import { BACKGROUND_STYLES, CANVAS_HEIGHT, type ThemeBackground, type ThemeSettings } from "@/lib/theme";
import type { LogoScreen, MediaCommand, MediaRef, MusicRender, ProjectorMediaStatus, ProjectorMusicStatus } from "@/services/presentation-engine/render-model";
import { MusicStage } from "./MusicStage";
import { CANVA_BAR_SPACE, canvaFrame } from "@/lib/canva";
import type { OutputMode } from "@/services/presentation-engine/engine";

export interface SlideRendererProps {
  content: SlideContent | null;
  slideKey: string | null;
  theme: ThemeSettings;
  output: OutputMode;
  media: Record<string, MediaRef>;
  logo: MediaRef | null;
  /** What the Logo button shows; without it, `logo` is centred on the theme background. */
  logoScreen?: LogoScreen | null;
  churchName?: string;
  /** Output aspect ratio (width / height). */
  aspect: number;
  /** True on the projector: plays video and animates transitions. */
  live?: boolean;
  mediaCommand?: MediaCommand | null;
  onMediaStatus?: (s: ProjectorMediaStatus) => void;
  /** Fade between slides, black, clear and logo (0 switches at once). */
  fadeMs?: number;
  /** Play the theme's slide transition in a preview (the theme editor shows it off). */
  animate?: boolean;
  /** Load web designs (Canva) instead of a placeholder. On for the output and its preview. */
  embeds?: boolean;
  /** The live song's music; the output window plays it, previews follow `musicStatus`. */
  music?: MusicRender | null;
  musicStatus?: ProjectorMusicStatus | null;
  onMusicStatus?: (s: ProjectorMusicStatus) => void;
  className?: string;
}

const textShadow = "0 2px 10px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.9)";

function textStyle(theme: ThemeSettings): CSSProperties {
  return {
    fontFamily: `"${theme.fontFamily}", "Inter Variable", "Segoe UI", sans-serif`,
    fontWeight: theme.fontWeight,
    color: theme.textColor,
    lineHeight: theme.lineHeight,
    textAlign: theme.textAlign,
    textTransform: theme.textTransform,
    fontStyle: theme.italic ? "italic" : undefined,
    textShadow: theme.textShadow ? textShadow : undefined,
    WebkitTextStroke: theme.textOutline ? "2px rgba(0,0,0,0.85)" : undefined,
    paintOrder: theme.textOutline ? "stroke fill" : undefined,
    overflowWrap: "break-word",
  };
}

const justify = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/** The text area: inside the safe margin, narrowed to the theme's text width and centred. */
function textBox(theme: ThemeSettings): CSSProperties {
  const m = theme.safeMargin;
  const side = m + ((100 - 2 * m) * (1 - theme.textWidth / 100)) / 2;
  return { top: `${m}%`, bottom: `${m}%`, left: `${side}%`, right: `${side}%` };
}

/**
 * Shrinks its text until it fits the available box (down to `minScale` of
 * the theme size), so long verses or lyrics never overflow the safe area.
 */
function FitText({ size, minScale = 0.4, children, style, contentKey }: { size: number; minScale?: number; children: ReactNode; style?: CSSProperties; contentKey: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(size);
  const [fontsReady, setFontsReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && setFontsReady((n) => n + 1));
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fits = (s: number) => {
      i.style.fontSize = `${s}px`;
      return i.scrollHeight <= o.clientHeight + 1 && i.scrollWidth <= o.clientWidth + 1;
    };
    if (fits(size)) {
      setFontSize(size);
      return;
    }
    let lo = size * minScale;
    let hi = size;
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    i.style.fontSize = `${lo}px`;
    setFontSize(lo);
  }, [size, minScale, contentKey, fontsReady]);

  return (
    <div ref={outer} className="flex h-full w-full flex-col overflow-hidden" style={{ justifyContent: style?.justifyContent }}>
      <div ref={inner} style={{ ...style, fontSize, justifyContent: undefined }}>
        {children}
      </div>
    </div>
  );
}

function fitClass(fit: string): CSSProperties["objectFit"] {
  return fit === "contain" ? "contain" : fit === "stretch" ? "fill" : "cover";
}

function Background({
  bg,
  media,
  live,
  onError,
}: {
  bg: ThemeBackground;
  media: Record<string, MediaRef>;
  live: boolean;
  onError?: (msg: string) => void;
}) {
  const ref = bg.mediaId ? media[bg.mediaId] : undefined;
  const fallback = <div className="absolute inset-0" style={{ background: bg.type === "black" ? "#000" : bg.color }} />;
  const design = bg.type === "black" || bg.type === "color" ? BACKGROUND_STYLES.find((s) => s.value === bg.style) : undefined;
  let layer: ReactNode = fallback;
  if (design?.css) {
    layer = (
      <>
        <div className="absolute inset-0" style={{ background: design.css }} />
        {design.frame && (
          <>
            <div className="absolute" style={{ inset: "3.2%", border: "2px solid rgb(224 185 92 / 0.6)", borderRadius: 6 }} />
            <div className="absolute" style={{ inset: "4.2%", border: "1px solid rgb(224 185 92 / 0.28)", borderRadius: 4 }} />
          </>
        )}
      </>
    );
  }
  if (bg.type === "image" && ref) {
    layer = (
      <>
        {fallback}
        <img src={ref.url} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: fitClass(bg.fit) }} draggable={false} />
      </>
    );
  } else if (bg.type === "video" && ref) {
    layer = live ? (
      <>
        {fallback}
        <video
          src={ref.url}
          className="absolute inset-0 h-full w-full"
          style={{ objectFit: fitClass(bg.fit) }}
          poster={ref.posterUrl ?? undefined}
          autoPlay
          loop={bg.videoLoop}
          muted={bg.videoMuted}
          playsInline
          onError={() => onError?.("The background video could not be played.")}
        />
      </>
    ) : (
      <>
        {fallback}
        {ref.posterUrl && <img src={ref.posterUrl} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: fitClass(bg.fit) }} />}
      </>
    );
  }
  return (
    <>
      {layer}
      {bg.overlayOpacity > 0 && <div className="absolute inset-0" style={{ background: bg.overlayColor, opacity: bg.overlayOpacity }} />}
    </>
  );
}

/**
 * A full-canvas layer that fades in and out. While fading out it keeps its
 * content, then unmounts it (so a hidden video stops playing).
 */
function FadeLayer({ visible, ms, children }: { visible: boolean; ms: number; children: ReactNode }) {
  const [phase, setPhase] = useState<"hidden" | "entering" | "shown" | "leaving">(visible ? "shown" : "hidden");
  useEffect(() => {
    if (visible) {
      if (ms <= 0) {
        setPhase("shown");
        return;
      }
      // A layer that is still fading out simply fades back in from where it is.
      setPhase((p) => (p === "hidden" ? "entering" : "shown"));
      // Paint the transparent state once, then fade to opaque.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase("shown"));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    if (ms <= 0) {
      setPhase("hidden");
      return;
    }
    setPhase((p) => (p === "hidden" ? p : "leaving"));
    const t = setTimeout(() => setPhase("hidden"), ms);
    return () => clearTimeout(t);
  }, [visible, ms]);
  if (phase === "hidden" && !visible) return null;
  return (
    <div
      className="absolute inset-0"
      data-fade={visible ? "in" : "out"}
      style={{ opacity: phase === "shown" ? 1 : 0, transition: ms > 0 ? `opacity ${ms}ms ease-in-out` : undefined }}
    >
      {children}
    </div>
  );
}

/**
 * Changes a layer by fading. When `id` changes, the new layer fades in over
 * the old one ("over", for backgrounds: no dip to black) or the two dissolve
 * into each other ("dissolve", for words). The old layer stays mounted until
 * the fade ends, so a playing video keeps running underneath.
 */
function CrossFade({ id, ms, mode, effect = "fade", children }: { id: string; ms: number; mode: "over" | "dissolve"; effect?: string; children: ReactNode }) {
  const latest = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const [previous, setPrevious] = useState<{ id: string; node: ReactNode } | null>(null);
  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    setPrevious(ms > 0 ? latest.current : null);
  }
  useEffect(() => {
    latest.current = { id, node: children };
  });
  useEffect(() => {
    if (!previous) return;
    const t = setTimeout(() => setPrevious(null), ms);
    return () => clearTimeout(t);
  }, [previous, ms]);
  const fading = previous !== null && previous.id !== id;
  return (
    <>
      {fading && (
        <div key={previous.id} className="absolute inset-0" style={mode === "dissolve" ? { animation: `sf-${effect}-out ${ms}ms ease-in-out both` } : undefined}>
          {previous.node}
        </div>
      )}
      <div key={id} className="absolute inset-0" style={fading ? { animation: `sf-${effect}-in ${ms}ms ease-in-out both` } : undefined}>
        {children}
      </div>
    </>
  );
}

function LogoScreenLayer({ screen, theme, media, live, churchName }: { screen: LogoScreen; theme: ThemeSettings; media: Record<string, MediaRef>; live: boolean; churchName: string }) {
  const logo = screen.logo;
  return (
    <>
      {screen.background && <Background bg={screen.background} media={media} live={live} />}
      {logo?.kind === "video" ? (
        live ? (
          <video src={logo.url} className="absolute inset-0 h-full w-full object-contain" autoPlay loop muted={!screen.sound} playsInline />
        ) : (
          logo.posterUrl && <img src={logo.posterUrl} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        )
      ) : logo ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={logo.url} alt="" className="object-contain" style={{ maxHeight: `${screen.size}%`, maxWidth: "80%" }} draggable={false} />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-[6%]">
          <div style={{ ...textStyle(theme), fontSize: 96, textAlign: "center" }}>{churchName}</div>
        </div>
      )}
    </>
  );
}

function WebSlide({
  content,
  embeds,
  media,
  W,
  H,
}: {
  content: Extract<SlideContent, { kind: "web" }>;
  embeds: boolean;
  media: Record<string, MediaRef>;
  W: number;
  H: number;
}) {
  const box = canvaFrame(W, H, content.aspect);
  const place: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  if (embeds) {
    return (
      // Canva's page bar is drawn below the design, outside this box.
      <div className="absolute overflow-hidden" style={place} data-canva-box>
        <iframe
          // Canva turns to the page in the address without reloading, so the
          // output and its preview always show the same page.
          src={`${content.url}#${content.page}`}
          title={content.title}
          className="pointer-events-none absolute left-0 border-0 bg-black"
          style={{ top: -CANVA_BAR_SPACE, width: box.width, height: box.height + 2 * CANVA_BAR_SPACE }}
          // The design may run its own scripts, but can never reach or navigate the app.
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  const picture = content.pictureId ? media[content.pictureId] : undefined;
  if (picture) {
    return <img src={picture.url} alt={`${content.title}, page ${content.page}`} className="absolute object-cover" style={place} draggable={false} />;
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#11151c] px-[8%] text-center text-white">
      <div style={{ fontSize: 120, lineHeight: 1 }} aria-hidden>
        ◎
      </div>
      <div style={{ fontSize: 72, fontWeight: 700 }}>{content.title}</div>
      <div style={{ fontSize: 96, fontWeight: 800 }}>Page {content.page}</div>
      <div style={{ fontSize: 40, opacity: 0.7 }}>Canva design · shown live on the output (needs the internet)</div>
    </div>
  );
}

function CustomElement({ el, media }: { el: SlideElement; media: Record<string, MediaRef> }) {
  const box: CSSProperties = {
    position: "absolute",
    left: `${el.box.x}%`,
    top: `${el.box.y}%`,
    width: `${el.box.w}%`,
    height: `${el.box.h}%`,
  };
  if (el.type === "shape") {
    return <div style={{ ...box, background: el.color, opacity: el.opacity, borderRadius: el.radius }} />;
  }
  if (el.type === "image") {
    const ref = el.mediaId ? media[el.mediaId] : undefined;
    if (!ref) return <div style={{ ...box, background: "rgba(255,255,255,0.04)" }} />;
    return (
      <img
        src={ref.kind === "video" ? (ref.posterUrl ?? "") : ref.url}
        alt=""
        draggable={false}
        style={{ ...box, objectFit: el.fit, objectPosition: `${el.cropX}% ${el.cropY}%`, opacity: el.opacity, borderRadius: el.radius }}
      />
    );
  }
  const style: CSSProperties = {
    fontFamily: `"${el.fontFamily}", "Inter Variable", sans-serif`,
    fontWeight: el.fontWeight,
    color: el.color,
    lineHeight: el.lineHeight,
    textAlign: el.align,
    fontStyle: el.italic ? "italic" : undefined,
    textTransform: el.uppercase ? "uppercase" : undefined,
    textShadow: el.shadow ? textShadow : undefined,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    justifyContent: justify[el.verticalAlign],
  };
  return (
    <div style={box}>
      {el.autoFit ? (
        <FitText size={el.fontSize} contentKey={`${el.id}:${el.text}:${el.fontSize}`} style={style}>
          {el.text}
        </FitText>
      ) : (
        <div className="flex h-full w-full flex-col overflow-hidden" style={{ justifyContent: style.justifyContent }}>
          <div style={{ ...style, fontSize: el.fontSize, justifyContent: undefined }}>{el.text}</div>
        </div>
      )}
    </div>
  );
}

function MediaSlide({
  content,
  media,
  live,
  command,
  onStatus,
}: {
  content: Extract<SlideContent, { kind: "media" }>;
  media: Record<string, MediaRef>;
  live: boolean;
  command: MediaCommand | null | undefined;
  onStatus?: (s: ProjectorMediaStatus) => void;
}) {
  const ref = media[content.mediaId];
  const video = useRef<HTMLVideoElement>(null);
  const lastSeq = useRef<number | null>(null);
  const lastReport = useRef(0);

  useEffect(() => {
    const v = video.current;
    if (!v || !command || command.seq === lastSeq.current) return;
    lastSeq.current = command.seq;
    if (command.action === "play") void v.play().catch(() => undefined);
    else if (command.action === "pause") v.pause();
    else {
      v.currentTime = 0;
      void v.play().catch(() => undefined);
    }
  }, [command]);

  if (!ref) return <div className="absolute inset-0 bg-black" />;
  const fit = fitClass(content.fit);
  if (content.mediaType === "image" || !live) {
    const src = content.mediaType === "image" ? ref.url : ref.posterUrl;
    return src ? <img src={src} alt="" className="absolute inset-0 h-full w-full bg-black" style={{ objectFit: fit }} /> : <div className="absolute inset-0 bg-black" />;
  }
  const report = (v: HTMLVideoElement, error: string | null = null, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport.current < 500) return;
    lastReport.current = now;
    onStatus?.({
      type: "media",
      mediaId: content.mediaId,
      playing: !v.paused && !v.ended,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      error,
    });
  };
  return (
    <video
      ref={video}
      src={ref.url}
      className="absolute inset-0 h-full w-full bg-black"
      style={{ objectFit: fit }}
      autoPlay
      loop={content.loop}
      muted={content.muted}
      playsInline
      onTimeUpdate={(e) => report(e.currentTarget)}
      onPlay={(e) => report(e.currentTarget, null, true)}
      onPause={(e) => report(e.currentTarget, null, true)}
      onEnded={(e) => report(e.currentTarget, null, true)}
      onLoadedMetadata={(e) => report(e.currentTarget, null, true)}
      onError={(e) =>
        report(
          e.currentTarget,
          "This video could not be played. Its format or codec may not be supported; try converting it to MP4 (H.264/AAC).",
          true,
        )
      }
    />
  );
}

function ContentLayer({
  content,
  theme,
  media,
  live,
  command,
  onStatus,
  contentKey,
  embeds,
  W,
  H,
}: {
  content: SlideContent;
  theme: ThemeSettings;
  media: Record<string, MediaRef>;
  live: boolean;
  command: MediaCommand | null | undefined;
  onStatus?: (s: ProjectorMediaStatus) => void;
  contentKey: string;
  embeds: boolean;
  W: number;
  H: number;
}) {
  const base = textStyle(theme);
  switch (content.kind) {
    case "blank":
      return null;
    case "web":
      return <WebSlide content={content} embeds={embeds} media={media} W={W} H={H} />;
    case "media":
      return <MediaSlide content={content} media={media} live={live} command={command} onStatus={onStatus} />;
    case "custom":
      return <CustomSlide slide={content.slide} media={media} />;
    case "lyrics":
      return (
        <div className="absolute flex flex-col" style={textBox(theme)}>
          <div className="min-h-0 flex-1">
            <FitText size={theme.fontSize} contentKey={contentKey} style={{ ...base, justifyContent: justify[theme.verticalAlign] }}>
              {content.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </FitText>
          </div>
          {theme.footer.showSongInfo && content.footer && (
            <div className="shrink-0 pt-4 text-center" style={{ fontSize: theme.footer.fontSize, color: theme.footer.color, fontFamily: base.fontFamily }}>
              {content.footer}
            </div>
          )}
        </div>
      );
    case "scripture": {
      const refLine = theme.reference.show ? (
        <div
          className="shrink-0"
          style={{
            fontSize: theme.reference.fontSize,
            color: theme.reference.color,
            fontFamily: base.fontFamily,
            fontWeight: 600,
            textAlign: theme.textAlign,
            textShadow: theme.textShadow ? textShadow : undefined,
            padding: theme.reference.position === "top" ? "0 0 0.6em" : "0.6em 0 0",
          }}
        >
          {content.reference}
          {theme.reference.showTranslation && content.translation ? ` (${content.translation})` : ""}
        </div>
      ) : null;
      return (
        <div className="absolute flex flex-col" style={textBox(theme)}>
          {theme.reference.position === "top" && refLine}
          <div className="min-h-0 flex-1">
            <FitText size={theme.fontSize} contentKey={contentKey} style={{ ...base, justifyContent: justify[theme.verticalAlign] }}>
              {content.verses.map((v, i) => (
                <span key={i}>
                  {theme.verseNumbers.show && v.number && (
                    <sup style={{ fontSize: "0.55em", opacity: 0.75, marginRight: "0.2em", verticalAlign: "super", lineHeight: 0 }}>{v.number}</sup>
                  )}
                  {v.text}
                  {i < content.verses.length - 1 ? " " : ""}
                </span>
              ))}
            </FitText>
          </div>
          {theme.reference.position === "bottom" && refLine}
        </div>
      );
    }
    case "text":
      return (
        <div className="absolute flex flex-col gap-[0.5em]" style={textBox(theme)}>
          <div className="min-h-0 flex-1">
            <FitText size={theme.fontSize} contentKey={contentKey} style={{ ...base, justifyContent: justify[theme.verticalAlign] }}>
              {content.title && <div style={{ fontSize: "1.15em", fontWeight: Math.min(900, theme.fontWeight + 100), marginBottom: "0.35em" }}>{content.title}</div>}
              <div style={{ whiteSpace: "pre-wrap", fontSize: content.title ? "0.8em" : undefined }}>{content.body}</div>
            </FitText>
          </div>
        </div>
      );
  }
}

function CustomSlide({ slide, media }: { slide: DeckSlide; media: Record<string, MediaRef> }) {
  return (
    <div className="absolute inset-0">
      {slide.elements.map((el) => (
        <CustomElement key={el.id} el={el} media={media} />
      ))}
    </div>
  );
}

/** Slides drawn with the theme's text style (others keep playing when the style changes). */
const TEXT_KINDS = new Set<SlideContent["kind"]>(["lyrics", "scripture", "text"]);

const logoCorner = {
  "top-left": { top: "4%", left: "3%" },
  "top-right": { top: "4%", right: "3%" },
  "bottom-left": { bottom: "4%", left: "3%" },
  "bottom-right": { bottom: "4%", right: "3%" },
} as const;

/**
 * Draws a slide on a logical canvas `aspect × 1080` and scales it to fit the
 * container, so previews and the projector lay out text identically.
 */
export function SlideRenderer({
  content,
  slideKey,
  theme,
  output: requestedOutput,
  media,
  logo,
  logoScreen,
  churchName,
  aspect,
  live = false,
  mediaCommand,
  onMediaStatus,
  fadeMs = 0,
  animate = false,
  embeds = live,
  music,
  musicStatus,
  onMusicStatus,
  className,
}: SlideRendererProps) {
  const container = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [bgError, setBgError] = useState(false);
  const W = Math.round(CANVAS_HEIGHT * (aspect > 0.2 && aspect < 6 ? aspect : 16 / 9));
  const H = CANVAS_HEIGHT;

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box.w && box.h ? Math.min(box.w / W, box.h / H) : 0;
  // A "black" holding slide behaves like the black output.
  const output: OutputMode = content?.kind === "blank" && content.black && requestedOutput === "normal" ? "black" : requestedOutput;
  const background: ThemeBackground =
    content?.kind === "custom" && content.slide.background ? content.slide.background : theme.background;
  // Slide-to-slide fades play on the output and its preview, not in thumbnails.
  const slideMs = (live || fadeMs > 0 || animate) && theme.transition.type !== "none" ? theme.transition.durationMs : 0;
  const bgKey = `${background.type}:${background.mediaId ?? background.color}`;
  // Restyled words (font, size, width…) dissolve into the new look too.
  const styleKey = useMemo(() => JSON.stringify({ ...theme, background: null, logo: null, transition: null }), [theme]);
  const themeLogo = theme.logo.show && theme.logo.mediaId ? media[theme.logo.mediaId] : undefined;
  const musicShown = !!music && music.view !== "slides";
  const screen: LogoScreen = logoScreen ?? { logo, background: null, size: 45, sound: false };
  // After Stop the slide is gone from the state but still fades out.
  const last = useRef<{ content: SlideContent; key: string | null } | null>(null);
  if (content) last.current = { content, key: slideKey };
  const shown = content ? { content, key: slideKey } : fadeMs > 0 ? last.current : null;

  useEffect(() => setBgError(false), [bgKey]);

  return (
    <div ref={container} className={className ?? "relative h-full w-full overflow-hidden"} style={{ background: "#000" }}>
      {scale > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            width: W,
            height: H,
            left: (box.w - W * scale) / 2,
            top: (box.h - H * scale) / 2,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <FadeLayer visible={output !== "black"} ms={fadeMs}>
            <CrossFade id={bgKey} ms={slideMs} mode="over">
              <Background
                bg={bgError ? { ...background, type: "color" } : background}
                media={media}
                live={live}
                onError={() => setBgError(true)}
              />
            </CrossFade>
          </FadeLayer>
          <FadeLayer visible={output === "normal" && !!content && !musicShown} ms={fadeMs}>
            {shown && (
              <CrossFade
                // A Canva design keeps one viewer for all its pages.
                id={shown.content.kind === "web" ? `web:${shown.content.url}` : `${shown.key ?? "none"}${TEXT_KINDS.has(shown.content.kind) ? `|${styleKey}` : ""}`}
                ms={slideMs}
                mode="dissolve"
                effect={theme.transition.type}
              >
                <ContentLayer
                  content={shown.content}
                  theme={theme}
                  media={media}
                  live={live}
                  command={mediaCommand}
                  onStatus={onMediaStatus}
                  contentKey={shown.key ?? ""}
                  embeds={embeds}
                  W={W}
                  H={H}
                />
              </CrossFade>
            )}
            {themeLogo && shown && shown.content.kind !== "media" && shown.content.kind !== "web" && (
              <img
                src={themeLogo.url}
                alt=""
                draggable={false}
                className="absolute object-contain"
                style={{ ...logoCorner[theme.logo.position], width: `${theme.logo.size}%`, maxHeight: "20%" }}
              />
            )}
          </FadeLayer>
          {music && (
            <MusicStage
              key={music.songId}
              music={music}
              live={live}
              status={musicStatus}
              visible={output === "normal" && musicShown}
              fadeMs={fadeMs}
              W={W}
              H={H}
              onStatus={onMusicStatus}
            />
          )}
          <FadeLayer visible={output === "logo"} ms={fadeMs}>
            <LogoScreenLayer screen={screen} theme={theme} media={media} live={live} churchName={churchName ?? ""} />
          </FadeLayer>
        </div>
      )}
    </div>
  );
}
