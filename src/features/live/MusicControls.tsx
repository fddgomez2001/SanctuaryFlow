import { useState } from "react";
import { ChevronsLeft, ChevronsRight, Music2, Pause, Play, Volume2 } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { activeLineIndex, formatClock, nextTimedIndex } from "@/lib/music/sync";
import { currentItem } from "@/services/presentation-engine/engine";
import type { MusicView } from "@/services/presentation-engine/render-model";
import { useLive } from "@/services/presentation-engine/store";
import { SPEEDS } from "@/features/songs/music/PlayerBar";
import { cn } from "@/lib/cn";

const VIEWS: { id: MusicView; label: string }[] = [
  { id: "slides", label: "Slides" },
  { id: "vinyl", label: "Vinyl" },
  { id: "lyrics", label: "Lyrics" },
  { id: "full", label: "Full song" },
];

/** Plays the live song's music on the output and chooses how it is shown. */
export function MusicControls() {
  const live = useLive();
  const item = currentItem(live.engine);
  const m = item?.music;
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  if (!m) return null;
  const status = live.musicStatus?.songId === m.songId ? live.musicStatus : null;
  const playing = status?.playing ?? false;
  const time = status?.currentTime ?? 0;
  const duration = status?.duration ?? 0;
  const lines = m.lines;
  const timed = lines.some((l) => l.startMs != null);
  const active = activeLineIndex(lines, time * 1000);
  let previous = -1;
  for (let i = (active >= 0 ? active : lines.length) - 1; i >= 0; i--) {
    if (lines[i]!.startMs != null) {
      previous = i;
      break;
    }
  }
  const next = nextTimedIndex(lines, active);
  const seekLine = (i: number) => i >= 0 && lines[i]!.startMs != null && live.musicControl("seek", lines[i]!.startMs! / 1000);

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg p-2" role="group" aria-label="Song music">
      <div className="flex items-center gap-2 text-xs">
        <Music2 className="size-4 text-primary" />
        <span className="min-w-0 flex-1 truncate font-semibold">{m.title}</span>
        {!live.projector.open && <span className="text-subtle">Start the output to play</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <IconButton
          variant="primary"
          label={playing ? "Pause music" : "Play music"}
          icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          onClick={() => live.musicControl(playing ? "pause" : "play")}
          disabled={!live.projector.open}
        />
        <IconButton size="sm" label="Previous line" icon={<ChevronsLeft className="size-4" />} onClick={() => seekLine(previous)} disabled={!timed || previous < 0} />
        <IconButton size="sm" label="Next line" icon={<ChevronsRight className="size-4" />} onClick={() => seekLine(next)} disabled={!timed || next < 0} />
        <span className="w-9 text-right text-[11px] tabular-nums text-muted">{formatClock(time)}</span>
        <input
          type="range"
          aria-label="Music position"
          min={0}
          max={duration || 0}
          step={0.5}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          onChange={(e) => live.musicControl("seek", Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-primary)]"
        />
        <span className="w-9 text-[11px] tabular-nums text-muted">{formatClock(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-0.5 rounded-md bg-panel p-0.5" role="tablist" aria-label="Show on the output">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={live.musicView === v.id}
              onClick={() => live.setMusicView(v.id)}
              className={cn("rounded px-2 py-0.5 text-[11px]", live.musicView === v.id ? "bg-elevated font-semibold text-text shadow-sm" : "text-muted hover:text-text")}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Volume2 className="ml-auto size-3.5 text-subtle" />
        <input
          type="range"
          aria-label="Music volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            live.musicControl("volume", Number(e.target.value));
          }}
          className="w-16 accent-[var(--color-primary)]"
        />
        <Select
          aria-label="Music speed"
          value={rate}
          onChange={(e) => {
            setRate(Number(e.target.value));
            live.musicControl("rate", Number(e.target.value));
          }}
          className="h-6 w-16 px-1 text-[11px]"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </Select>
      </div>
      {status?.error && <p className="text-xs text-danger">{status.error}</p>}
      {!timed && <p className="text-[11px] text-subtle">To show the words with the music, sync this song's lyrics in the Song Library.</p>}
    </div>
  );
}
