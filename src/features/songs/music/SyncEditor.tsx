import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, Pause, Play, Plus, RotateCcw, Scissors, SkipForward, Trash2 } from "lucide-react";
import type { Song } from "@/types/generated/Song";
import { api } from "@/services/api";
import { Button, IconButton } from "@/components/ui/Button";
import { confirm, Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { activeLineIndex, buildSyncLines, formatClock, formatMs, mergeTimings, nextTimedIndex, parseMs, type LyricLine } from "@/lib/music/sync";
import { newId } from "@/lib/slides/deck";
import { cn } from "@/lib/cn";
import { songToDocument } from "../SongEditor";
import { useAudio } from "./useAudio";

function TimeField({ label, value, onChange }: { label: string; value: number | null; onChange: (ms: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : formatMs(value));
  useEffect(() => setText(value == null ? "" : formatMs(value)), [value]);
  const commit = () => {
    if (!text.trim()) return onChange(null);
    const ms = parseMs(text);
    if (ms == null) setText(value == null ? "" : formatMs(value));
    else onChange(ms);
  };
  return (
    <Input
      aria-label={label}
      value={text}
      placeholder="–:––"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-7 w-20 px-1.5 font-mono text-xs"
    />
  );
}

/**
 * Times a song's lyrics to its recording: play the music and tap at the
 * start of each line (or type times), then save. The lines follow the
 * song's presentation order; they can be split, added, moved or removed.
 * (Automatic alignment could later fill these times in for review; see
 * docs/LYRICS_SYNC.md.)
 */
export function SyncEditor({ song, audioUrl, onClose }: { song: Song; audioUrl: string; onClose: () => void }) {
  const qc = useQueryClient();
  const initial = useMemo(() => (song.lyricSync?.length ? song.lyricSync : buildSyncLines(song)), [song]);
  const [lines, setLines] = useState<LyricLine[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [cursor, setCursor] = useState(() => Math.max(0, initial.findIndex((l) => l.startMs == null)));
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const audio = useAudio(audioUrl);
  const caret = useRef(new Map<string, number>());
  const rows = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(lines) !== saved;
  const playingIndex = activeLineIndex(lines, audio.time * 1000);
  const durationMs = audio.duration * 1000;

  const update = (i: number, patch: Partial<LyricLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** The line being tapped gets the current time; the cursor moves on. */
  const tap = () => {
    const ms = Math.round(audio.now() * 1000);
    setLines((ls) =>
      ls.map((l, j) => {
        if (j === cursor) return { ...l, startMs: ms, endMs: l.endMs != null && l.endMs <= ms ? null : l.endMs };
        if (j === cursor - 1 && l.endMs != null && l.endMs > ms) return { ...l, endMs: null };
        return l;
      }),
    );
    setCursor((c) => Math.min(c + 1, lines.length - 1));
  };
  /** Ends the line being sung now (for an instrumental part before the next line). */
  const endHere = () => {
    const i = playingIndex >= 0 ? playingIndex : cursor - 1;
    if (i >= 0) update(i, { endMs: Math.round(audio.now() * 1000) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      // A focused button handles its own Space and Enter.
      if (target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      if (e.key === "t" || e.key === "T" || e.key === "Enter") {
        e.preventDefault();
        tap();
      } else if (e.key === " ") {
        e.preventDefault();
        audio.toggle();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        endHere();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    rows.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.songs.save({ ...songToDocument(song), lyricSync: lines });
      qc.setQueryData(["song", song.id], result);
      const stored = result.lyricSync ?? [];
      setLines(stored);
      setSaved(JSON.stringify(stored));
      toast.success("Lyric timing saved");
    } catch (e) {
      toast.error("The timing could not be saved", e);
    } finally {
      setSaving(false);
    }
  };
  const close = async () => {
    if (dirty && !(await confirm({ title: "Leave without saving?", message: "The lyric timing has changes that are not saved.", confirmLabel: "Leave", danger: true }))) return;
    onClose();
  };
  const split = (i: number) => {
    const line = lines[i]!;
    const words = line.text.split(" ");
    const at = caret.current.get(line.id) ?? line.text.indexOf(" ", Math.floor(line.text.length / 2));
    const cut = at > 0 && at < line.text.length ? at : words.length > 1 ? line.text.length - words[words.length - 1]!.length - 1 : -1;
    if (cut <= 0) return;
    const first = line.text.slice(0, cut).trim();
    const second = line.text.slice(cut).trim();
    if (!first || !second) return;
    setLines((ls) => [...ls.slice(0, i), { ...line, text: first, endMs: null }, { id: newId(), section: line.section, text: second, startMs: null, endMs: line.endMs }, ...ls.slice(i + 1)]);
  };
  const move = (i: number, dir: -1 | 1) =>
    setLines((ls) => {
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const current = playingIndex >= 0 ? lines[playingIndex] : null;
  const upcoming = lines[nextTimedIndex(lines, playingIndex)] ?? null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && void close()}
      size="xl"
      title={`Sync lyrics: ${song.title}`}
      description="Play the song and press Tap (or T / Enter) as each line starts. Space plays and pauses; E ends a line before an instrumental part."
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RotateCcw className="size-4" />}
            onClick={() => setLines((ls) => mergeTimings(ls, buildSyncLines(song)))}
            title="Make the lines match the song's lyrics again; lines that are still there keep their times"
          >
            Rebuild from lyrics
          </Button>
          <Button variant="ghost" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, startMs: null, endMs: null })))}>
            Clear all times
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setLines(JSON.parse(saved) as LyricLine[])} disabled={!dirty}>
            Undo changes
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save timing
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton variant="primary" label={audio.playing ? "Pause" : "Play"} icon={audio.playing ? <Pause className="size-5" /> : <Play className="size-5" />} onClick={audio.toggle} />
          <Button variant="primary" size="lg" className="min-w-36" onClick={tap} disabled={!lines.length}>
            Tap · line {Math.min(cursor + 1, lines.length)}
          </Button>
          <Button onClick={endHere} title="End the line being sung now, before an instrumental part">
            End line here
          </Button>
          <span className="ml-2 font-mono text-sm tabular-nums">
            {formatMs(audio.time * 1000)} / {formatClock(audio.duration)}
          </span>
          <div className="flex-1" />
          <Button icon={<Eye className="size-4" />} variant={preview ? "primary" : "secondary"} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            Preview
          </Button>
        </div>

        {/* Timeline: the playhead, and a mark where each line starts. Click to jump. */}
        <div
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(audio.duration)}
          aria-valuenow={Math.round(audio.time)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") audio.seek(audio.time + 5);
            if (e.key === "ArrowLeft") audio.seek(audio.time - 5);
          }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            audio.seek(((e.clientX - r.left) / r.width) * audio.duration);
          }}
          className="relative h-8 cursor-pointer overflow-hidden rounded-md bg-bg"
        >
          <div className="absolute inset-y-0 left-0 bg-primary/25" style={{ width: durationMs ? `${(100 * audio.time * 1000) / durationMs}%` : 0 }} />
          {durationMs > 0 &&
            lines.map((l, i) =>
              l.startMs != null ? (
                <span
                  key={l.id}
                  className={cn("absolute inset-y-1 w-0.5 rounded", i === playingIndex ? "bg-live" : "bg-muted")}
                  style={{ left: `${(100 * l.startMs) / durationMs}%` }}
                  title={`${formatMs(l.startMs)} · ${l.text}`}
                />
              ) : null,
            )}
        </div>

        {preview && (
          <div className="flex h-44 flex-col items-center justify-center rounded-lg bg-black px-6 text-center" aria-live="polite">
            <p className="text-3xl font-semibold text-white">{current?.text ?? "♪"}</p>
            <p className="mt-3 text-lg text-white/50">{upcoming?.text ?? ""}</p>
          </div>
        )}

        <div ref={rows} className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
          {lines.length === 0 && <p className="text-sm text-muted">This song has no lyrics yet. Add lyrics to the song first.</p>}
          {lines.map((line, i) => (
            <div
              key={line.id}
              data-row={i}
              onClick={() => setCursor(i)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-1.5 py-1",
                i === playingIndex ? "border-live bg-live/10" : i === cursor ? "border-primary bg-primary/10" : "border-transparent hover:bg-elevated",
              )}
            >
              <span className="w-6 text-right text-[11px] text-subtle">{i + 1}</span>
              <TimeField label={`Start of line ${i + 1}`} value={line.startMs} onChange={(ms) => update(i, { startMs: ms })} />
              <TimeField label={`End of line ${i + 1}`} value={line.endMs} onChange={(ms) => update(i, { endMs: ms })} />
              <span className="hidden w-20 truncate text-[11px] text-subtle lg:block" title={line.section}>
                {line.section}
              </span>
              <Input
                aria-label={`Line ${i + 1}`}
                value={line.text}
                onChange={(e) => update(i, { text: e.target.value })}
                onSelect={(e) => caret.current.set(line.id, e.currentTarget.selectionStart ?? 0)}
                className="h-7 min-w-0 flex-1 text-sm"
              />
              <IconButton size="sm" label="Play from this line" icon={<SkipForward className="size-3.5" />} disabled={line.startMs == null} onClick={() => line.startMs != null && (audio.seek(line.startMs / 1000), audio.play())} />
              <IconButton size="sm" label="Split this line" icon={<Scissors className="size-3.5" />} onClick={() => split(i)} />
              <IconButton
                size="sm"
                label="Add a line below"
                icon={<Plus className="size-3.5" />}
                onClick={() => setLines((ls) => [...ls.slice(0, i + 1), { id: newId(), section: line.section, text: "New line", startMs: null, endMs: null }, ...ls.slice(i + 1)])}
              />
              <IconButton size="sm" label="Move up" icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} disabled={i === 0} />
              <IconButton size="sm" label="Move down" icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} disabled={i === lines.length - 1} />
              <IconButton size="sm" label="Delete line" icon={<Trash2 className="size-3.5" />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
