import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { activeLineIndex, nextTimedIndex } from "@/lib/music/sync";
import type { MusicRender, ProjectorMusicStatus } from "@/services/presentation-engine/render-model";

const DESIGN = { w: 1080, h: 675 };
const OUTFIT = '"Outfit Variable", "Inter Variable", sans-serif';
const shadow = "0 4px 18px rgba(0,0,0,0.75)";

interface Clock {
  time: number;
  playing: boolean;
}

/**
 * The live song's music on the output. On the output window it owns the
 * audio (following the operator's play, pause, seek, speed and volume) and
 * reports its position back; in previews it follows those reports. It shows
 * the vinyl record, large synchronized lyrics, or the whole song.
 */
export function MusicStage({
  music,
  live,
  status,
  visible,
  fadeMs,
  W,
  H,
  onStatus,
}: {
  music: MusicRender;
  live: boolean;
  status: ProjectorMusicStatus | null | undefined;
  visible: boolean;
  fadeMs: number;
  W: number;
  H: number;
  onStatus?: (s: ProjectorMusicStatus) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const lastSeq = useRef<number | null>(null);
  const [own, setOwn] = useState<Clock>({ time: 0, playing: false });
  const clock: Clock = live ? own : { time: status?.songId === music.songId ? status.currentTime : 0, playing: status?.songId === music.songId && status.playing };

  const report = (a: HTMLAudioElement, error: string | null = null) =>
    onStatus?.({ type: "music", songId: music.songId, playing: !a.paused && !a.ended, currentTime: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0, error });

  // Operator commands.
  useEffect(() => {
    const a = audio.current;
    const c = music.command;
    if (!live || !a || !c || c.seq === lastSeq.current) return;
    lastSeq.current = c.seq;
    if (c.action === "play") void a.play().catch(() => undefined);
    else if (c.action === "pause") a.pause();
    else if (c.action === "seek" && c.value !== undefined) a.currentTime = Math.max(0, c.value);
    else if (c.action === "rate" && c.value) a.playbackRate = c.value;
    else if (c.action === "volume" && c.value !== undefined) a.volume = Math.min(1, Math.max(0, c.value));
  }, [live, music.command]);

  // While playing, follow the position closely and tell the operator.
  useEffect(() => {
    if (!live || !own.playing) return;
    const a = audio.current;
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      if (a) {
        setOwn({ time: a.currentTime, playing: !a.paused });
        if (t - last > 250) {
          last = t;
          report(a);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restarted when playback starts or stops.
  }, [live, own.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = music.lines;
  const timed = lines.some((l) => l.startMs != null);
  const active = activeLineIndex(lines, clock.time * 1000);
  const upcoming = lines[nextTimedIndex(lines, active)] ?? null;
  const current = active >= 0 ? lines[active]! : null;

  return (
    <>
      {live && (
        <audio
          ref={audio}
          src={music.audio.url}
          preload="auto"
          onPlay={(e) => {
            setOwn({ time: e.currentTarget.currentTime, playing: true });
            report(e.currentTarget);
          }}
          onPause={(e) => {
            setOwn({ time: e.currentTarget.currentTime, playing: false });
            report(e.currentTarget);
          }}
          onEnded={(e) => {
            setOwn({ time: e.currentTarget.currentTime, playing: false });
            report(e.currentTarget);
          }}
          onSeeked={(e) => {
            // Read now: React clears the event's element after this handler.
            const time = e.currentTarget.currentTime;
            setOwn((c) => ({ ...c, time }));
            report(e.currentTarget);
          }}
          onLoadedMetadata={(e) => report(e.currentTarget)}
          onError={(e) => report(e.currentTarget, "The song's music file could not be played. Try an MP3, M4A or WAV file.")}
        />
      )}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ opacity: visible ? 1 : 0, transition: fadeMs > 0 ? `opacity ${fadeMs}ms ease-in-out` : undefined, pointerEvents: "none" }}
        data-music-view={music.view}
        aria-hidden={!visible}
      >
        {visible && (
          <>
            <Backdrop music={music} dim={music.view === "vinyl" ? 0.55 : 0.78} />
            {music.view === "vinyl" && <Vinyl music={music} playing={clock.playing} W={W} H={H} lyric={timed ? current?.text ?? "" : null} upcoming={timed ? upcoming?.text ?? "" : null} activeKey={active} />}
            {music.view === "lyrics" && <BigLyrics music={music} current={current?.text ?? null} upcoming={upcoming?.text ?? null} activeKey={active} timed={timed} />}
            {music.view === "full" && <FullSong music={music} active={active} H={H} />}
          </>
        )}
      </div>
    </>
  );
}

/** The cover as a picture (a video logo shows its still frame). */
const coverSrc = (music: MusicRender) => (music.cover ? (music.cover.kind === "video" ? music.cover.posterUrl : music.cover.url) : null);

function Backdrop({ music, dim }: { music: MusicRender; dim: number }) {
  const src = coverSrc(music);
  return (
    <div className="absolute inset-0 bg-[#07090d]">
      {src && <img src={src} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover" style={{ filter: "blur(60px) saturate(1.2)" }} draggable={false} />}
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim})` }} />
    </div>
  );
}

function Cover({ music, style }: { music: MusicRender; style?: CSSProperties }) {
  const src = coverSrc(music);
  return src ? (
    <img src={src} alt="" className="absolute h-full w-full object-cover" style={style} draggable={false} />
  ) : (
    <div className="absolute h-full w-full" style={{ background: "linear-gradient(135deg, #b0842a, #2a1f0c)", ...style }} />
  );
}

/** The record sleeve with the vinyl turning behind it, laid out like the design (1080 × 675). */
function Vinyl({
  music,
  playing,
  W,
  H,
  lyric,
  upcoming,
  activeKey,
}: {
  music: MusicRender;
  playing: boolean;
  W: number;
  H: number;
  lyric: string | null;
  upcoming: string | null;
  activeKey: number;
}) {
  const withLyrics = lyric !== null;
  const s = Math.min((W * 0.9) / DESIGN.w, (H * (withLyrics ? 0.7 : 0.86)) / DESIGN.h);
  const left = (W - DESIGN.w * s) / 2;
  const top = withLyrics ? H * 0.05 : (H - DESIGN.h * s) / 2;
  const px = (v: number) => v * s;
  return (
    <>
      <div className="absolute" style={{ left, top, width: px(DESIGN.w), height: px(DESIGN.h) }}>
        {/* The record: grooves and label turn clockwise while the music plays. */}
        <div
          className="absolute rounded-full"
          data-vinyl-disc
          style={{
            left: px(440),
            top: px(61),
            width: px(546),
            height: px(546),
            background: "repeating-radial-gradient(circle at 50% 50%, #0c0c0c 0px, #0c0c0c 2px, #1b1b1b 3px, #0e0e0e 5px)",
            boxShadow: `0 ${px(24)}px ${px(60)}px rgba(0,0,0,0.6)`,
            animation: "sf-spin 1.8s linear infinite",
            animationPlayState: playing ? "running" : "paused",
          }}
        >
          <div className="absolute overflow-hidden rounded-full" style={{ left: px(188), top: px(188), width: px(170), height: px(170), boxShadow: `0 0 0 ${px(5)}px rgba(0,0,0,0.55)` }}>
            <Cover music={music} />
          </div>
          <div className="absolute rounded-full bg-white" style={{ left: px(267), top: px(267), width: px(12), height: px(12), boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)" }} />
        </div>
        {/* A light reflection that stays still while the record turns. */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: px(440),
            top: px(61),
            width: px(546),
            height: px(546),
            background: "conic-gradient(from 30deg, transparent 0deg, rgba(255,255,255,0.09) 40deg, transparent 80deg, transparent 200deg, rgba(255,255,255,0.06) 230deg, transparent 270deg)",
          }}
        />
        {/* The sleeve. */}
        <div className="absolute bg-black" style={{ left: px(74), top: px(30), width: px(612), height: px(612), boxShadow: `0 ${px(24)}px ${px(70)}px rgba(0,0,0,0.65)` }}>
          <div className="absolute overflow-hidden" style={{ left: px(15), top: px(15), width: px(582), height: px(582) }}>
            <Cover music={music} />
            <div className="absolute inset-x-0 bottom-0" style={{ height: "45%", background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.72))" }} />
            <div className="absolute" style={{ left: px(26), right: px(26), bottom: px(34) }}>
              <p className="truncate text-white" style={{ fontFamily: OUTFIT, fontWeight: 600, fontSize: px(32), lineHeight: `${px(40)}px`, textShadow: shadow }}>
                {music.title.toUpperCase()}
              </p>
              {music.artist && (
                <p className="truncate text-white" style={{ fontFamily: OUTFIT, fontWeight: 200, fontSize: px(20), lineHeight: `${px(25)}px`, letterSpacing: "0.5em", textShadow: shadow }}>
                  {music.artist}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {withLyrics && (
        <div className="absolute inset-x-[6%] flex flex-col justify-center" style={{ top: top + px(DESIGN.h) + H * 0.02, bottom: H * 0.03, textAlign: music.align }}>
          <p key={activeKey} className="text-white" style={{ fontFamily: OUTFIT, fontWeight: 600, fontSize: music.fontSize, lineHeight: 1.15, textShadow: shadow, animation: "sf-fade-in 300ms ease-out both" }}>
            {lyric || " "}
          </p>
          <p className="mt-2 text-white/50" style={{ fontFamily: OUTFIT, fontWeight: 400, fontSize: music.fontSize * 0.55, textShadow: shadow }}>
            {upcoming || " "}
          </p>
        </div>
      )}
    </>
  );
}

/** The line being sung, very large, with the next line under it. */
function BigLyrics({ music, current, upcoming, activeKey, timed }: { music: MusicRender; current: string | null; upcoming: string | null; activeKey: number; timed: boolean }) {
  return (
    <div className="absolute inset-[7%] flex flex-col justify-center" style={{ textAlign: music.align, fontFamily: OUTFIT }}>
      {timed ? (
        <>
          <p key={activeKey} className="font-semibold text-white" style={{ fontSize: music.fontSize * 1.35, lineHeight: 1.15, textShadow: shadow, animation: "sf-fade-in 300ms ease-out both" }}>
            {current ?? "♪"}
          </p>
          <p className="mt-6 text-white/45" style={{ fontSize: music.fontSize * 0.7, lineHeight: 1.2 }}>
            {upcoming ?? ""}
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold text-white" style={{ fontSize: music.fontSize * 1.2 }}>
            {music.title}
          </p>
          {music.artist && <p className="mt-3 text-white/60" style={{ fontSize: music.fontSize * 0.6 }}>{music.artist}</p>}
        </>
      )}
    </div>
  );
}

/** The whole song, scrolling so the line being sung stays in the middle. */
function FullSong({ music, active, H }: { music: MusicRender; active: number; H: number }) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${Math.max(0, active)}"]`);
    if (el) setOffset(H / 2 - (el.offsetTop + el.offsetHeight / 2));
  }, [active, H, music.lines]);
  const size = music.fontSize * 0.8;
  return (
    <div className="absolute inset-x-[8%] inset-y-0 overflow-hidden" style={{ fontFamily: OUTFIT, textAlign: music.align }}>
      <div ref={list} style={{ transform: `translateY(${offset}px)`, transition: "transform 600ms ease-in-out" }}>
        {music.lines.map((line, i) => (
          <p
            key={i}
            data-line={i}
            style={{
              fontSize: size,
              lineHeight: 1.35,
              fontWeight: i === active ? 700 : 500,
              color: "#fff",
              opacity: i === active ? 1 : 0.32,
              transition: "opacity 300ms",
              textShadow: i === active ? shadow : undefined,
            }}
          >
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}
