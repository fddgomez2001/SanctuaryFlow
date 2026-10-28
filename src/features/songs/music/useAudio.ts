import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioState {
  playing: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  loading: boolean;
  error: string | null;
  volume: number;
  rate: number;
}

export interface AudioControls extends AudioState {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  setRate: (r: number) => void;
  /** The exact playback position now, in seconds (for tapping lyric times). */
  now: () => number;
}

/**
 * Plays one audio file. The element lives as long as the URL does, so
 * re-rendering the page never interrupts the music. The position updates on
 * every frame while playing, so highlighted lyrics follow closely.
 */
export function useAudio(url: string | null, opts: { autoPlay?: boolean; onEnded?: () => void } = {}): AudioControls {
  const el = useRef<HTMLAudioElement | null>(null);
  const ended = useRef(opts.onEnded);
  ended.current = opts.onEnded;
  const [state, setState] = useState<AudioState>({ playing: false, time: 0, duration: 0, loading: false, error: null, volume: 1, rate: 1 });
  const prefs = useRef({ volume: 1, rate: 1 });

  useEffect(() => {
    if (!url) {
      setState((s) => ({ ...s, playing: false, time: 0, duration: 0, loading: false, error: null }));
      return;
    }
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = prefs.current.volume;
    audio.playbackRate = prefs.current.rate;
    el.current = audio;
    let frame = 0;
    const tick = () => {
      setState((s) => ({ ...s, time: audio.currentTime }));
      frame = requestAnimationFrame(tick);
    };
    const on = (name: string, fn: () => void) => audio.addEventListener(name, fn);
    on("loadstart", () => setState((s) => ({ ...s, loading: true, error: null, time: 0, duration: 0 })));
    on("loadedmetadata", () => setState((s) => ({ ...s, duration: Number.isFinite(audio.duration) ? audio.duration : 0 })));
    on("canplay", () => setState((s) => ({ ...s, loading: false })));
    on("waiting", () => setState((s) => ({ ...s, loading: true })));
    on("playing", () => {
      setState((s) => ({ ...s, playing: true, loading: false }));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    });
    on("pause", () => {
      cancelAnimationFrame(frame);
      setState((s) => ({ ...s, playing: false, time: audio.currentTime }));
    });
    on("ended", () => {
      cancelAnimationFrame(frame);
      setState((s) => ({ ...s, playing: false, time: audio.duration || s.time }));
      ended.current?.();
    });
    on("seeked", () => setState((s) => ({ ...s, time: audio.currentTime })));
    on("error", () =>
      setState((s) => ({ ...s, loading: false, playing: false, error: "This music file could not be played. Try an MP3, M4A or WAV file." })),
    );
    audio.src = url;
    if (opts.autoPlay) void audio.play().catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (el.current === audio) el.current = null;
    };
    // Autoplay is read when a new file starts, not on every change.
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(() => void el.current?.play().catch(() => undefined), []);
  const pause = useCallback(() => el.current?.pause(), []);
  const toggle = useCallback(() => {
    const a = el.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);
  const seek = useCallback((seconds: number) => {
    const a = el.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(a.duration) ? a.duration : seconds));
    setState((s) => ({ ...s, time: a.currentTime }));
  }, []);
  const setVolume = useCallback((v: number) => {
    prefs.current.volume = v;
    if (el.current) el.current.volume = v;
    setState((s) => ({ ...s, volume: v }));
  }, []);
  const setRate = useCallback((r: number) => {
    prefs.current.rate = r;
    if (el.current) el.current.playbackRate = r;
    setState((s) => ({ ...s, rate: r }));
  }, []);
  const now = useCallback(() => el.current?.currentTime ?? 0, []);

  return { ...state, play, pause, toggle, seek, setVolume, setRate, now };
}
