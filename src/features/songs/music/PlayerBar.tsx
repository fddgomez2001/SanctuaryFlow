import { Loader2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { formatClock } from "@/lib/music/sync";
import type { AudioControls } from "./useAudio";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

/** Play/pause, previous/next, seek, time, volume and speed for one song. */
export function PlayerBar({ audio, onPrevious, onNext }: { audio: AudioControls; onPrevious?: () => void; onNext?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Music player">
      <IconButton size="sm" label="Previous song" icon={<SkipBack className="size-4" />} onClick={onPrevious} disabled={!onPrevious} />
      <IconButton
        size="md"
        variant="primary"
        label={audio.playing ? "Pause" : "Play"}
        shortcut="Space"
        icon={audio.loading && audio.playing ? <Loader2 className="size-5 animate-spin" /> : audio.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        onClick={audio.toggle}
        disabled={!!audio.error}
      />
      <IconButton size="sm" label="Next song" icon={<SkipForward className="size-4" />} onClick={onNext} disabled={!onNext} />
      <span className="w-11 text-right text-xs tabular-nums text-muted">{formatClock(audio.time)}</span>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={audio.duration || 0}
        step={0.1}
        value={Math.min(audio.time, audio.duration || 0)}
        onChange={(e) => audio.seek(Number(e.target.value))}
        disabled={!audio.duration}
        className="min-w-32 flex-1 accent-[var(--color-primary)]"
      />
      <span className="w-11 text-xs tabular-nums text-muted">{formatClock(audio.duration)}</span>
      <IconButton
        size="sm"
        label={audio.volume === 0 ? "Unmute" : "Mute"}
        icon={audio.volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        onClick={() => audio.setVolume(audio.volume === 0 ? 1 : 0)}
      />
      <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={audio.volume} onChange={(e) => audio.setVolume(Number(e.target.value))} className="w-20 accent-[var(--color-primary)]" />
      <Select aria-label="Speed" value={audio.rate} onChange={(e) => audio.setRate(Number(e.target.value))} className="h-7 w-20 text-xs">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </Select>
    </div>
  );
}
