import { useEffect, useRef } from "react";
import type { Slide } from "@/lib/slides/types";
import type { ThemeSettings } from "@/lib/theme";
import { slideTextLines } from "@/lib/slides/colors";
import { groupSlides } from "@/lib/slides/groups";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { SlideThumb } from "@/components/slide/SlideThumb";
import type { MediaRef } from "@/services/presentation-engine/render-model";
import { cn } from "@/lib/cn";

export type SlideView = "grid" | "list";

interface Props {
  slides: Slide[];
  view: SlideView;
  theme: ThemeSettings;
  media: Record<string, MediaRef>;
  aspect: number;
  liveIndex: number | null;
  nextId: string | null;
  /** The output is open: the slide on screen is marked LIVE and the next one NEXT. Otherwise the chosen slide is only highlighted. */
  onAir: boolean;
  onPick: (index: number) => void;
}

/** "Verse 1" → "V1", "Chorus" → "C", "Pre-Chorus 2" → "PC2": the short names singers use. */
export function partShortName(label: string): string {
  const m = /^(.*?)\s*(\d+)?$/.exec(label.trim());
  const words = (m?.[1] ?? label).split(/[\s-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join("") : (words[0] ?? "?").slice(0, words[0]?.toLowerCase() === "interlude" ? 2 : 1).toUpperCase();
  return `${letters}${m?.[2] ?? ""}`;
}

/**
 * The song's parts in one calm row ("V1 · C1 · V2 · B…"): one click puts a
 * part's first line on screen from anywhere in the list. The part being
 * shown is filled in gold; a part sung more than once goes to its next time.
 */
function PartJumps({ slides, liveIndex, onPick }: { slides: Slide[]; liveIndex: number | null; onPick: (index: number) => void }) {
  const groups = groupSlides(slides).filter((g) => g.slides[0]!.slide.content.kind === "lyrics");
  const parts: { label: string; color: string | null }[] = [];
  for (const g of groups) if (!parts.some((p) => p.label === g.label)) parts.push({ label: g.label, color: g.color });
  if (parts.length < 2) return null;
  const currentLabel = liveIndex == null ? null : groups.find((g) => g.slides.some((s) => s.index === liveIndex))?.label;
  const go = (label: string) => {
    const times = groups.filter((g) => g.label === label);
    const target = times.find((g) => liveIndex == null || g.slides[0]!.index > liveIndex) ?? times[0]!;
    onPick(target.slides[0]!.index);
  };
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur">
      <div role="toolbar" aria-label="Jump to a song part" className="flex items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
        <span className="mr-1.5 shrink-0 text-[11px] font-semibold tracking-wider text-subtle uppercase">Jump</span>
        {parts.map((p) => {
          const current = p.label === currentLabel;
          return (
            <button
              key={p.label}
              type="button"
              aria-label={`Jump to ${p.label}`}
              aria-current={current ? "true" : undefined}
              title={p.label}
              onClick={() => go(p.label)}
              className={cn(
                "flex h-7 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-bold tabular-nums transition active:scale-95",
                current ? "border-primary bg-primary text-white shadow-sm" : "border-border bg-panel text-text hover:border-primary/60 hover:bg-primary/10",
              )}
            >
              <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: current ? "#fff" : (p.color ?? "var(--color-primary)") }} />
              {partShortName(p.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected item's slides as thumbnails (grid) or as readable text (list). */
export function LiveSlides({ slides, view, theme, media, aspect, liveIndex, nextId, onAir, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Keep the slide on screen visible as the service moves on.
  useEffect(() => {
    box.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [liveIndex, view]);
  const jumps = <PartJumps slides={slides} liveIndex={liveIndex} onPick={onPick} />;

  if (view === "grid") {
    return (
      <>
      {jumps}
      <div ref={box} className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {slides.map((slide, i) => (
          <SlideThumb
            key={slide.id}
            slide={slide}
            index={i}
            theme={theme}
            media={media}
            aspect={aspect}
            active={liveIndex === i}
            next={onAir && nextId === slide.id}
            onAir={onAir}
            onClick={() => onPick(i)}
          />
        ))}
      </div>
      </>
    );
  }
  return (
    <>
    {jumps}
    <div ref={box} className="space-y-3">
      {groupSlides(slides).map((group) => (
        <section
          key={group.slides[0]!.index}
          role="group"
          aria-label={group.label}
          className="overflow-hidden rounded-lg border border-l-4 border-border bg-panel"
          style={group.color ? { borderLeftColor: group.color } : undefined}
        >
          <header className="px-3 pt-2 pb-1">
            {group.color ? (
              <span className="rounded px-1.5 py-px text-xs font-semibold text-white" style={{ backgroundColor: group.color }}>
                {group.label}
              </span>
            ) : (
              <span className="text-xs font-semibold text-muted">{group.label}</span>
            )}
          </header>
          <div className="pb-1">
            {group.slides.map(({ slide, index }) => {
              const active = liveIndex === index;
              const next = onAir && !active && nextId === slide.id;
              const lines = slideTextLines(slide);
              const wordless = WORDLESS.has(slide.content.kind) || lines.length === 0;
              return (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => onPick(index)}
                  aria-current={active ? "true" : undefined}
                  aria-label={`Slide ${index + 1}: ${slide.label}${active ? (onAir ? " (on screen)" : " (chosen)") : ""}`}
                  className={cn(
                    "flex w-full items-start gap-3 border-l-4 px-3 py-1.5 text-left transition-colors",
                    active && onAir
                      ? "border-live bg-live/10"
                      : active
                        ? "border-primary bg-primary/15"
                        : next
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] text-subtle">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    {wordless ? (
                      <div className="flex items-center gap-3">
                        <div className="relative w-28 shrink-0 overflow-hidden rounded border border-border" style={{ aspectRatio: aspect }}>
                          <SlideRenderer content={slide.content} slideKey={slide.id} theme={theme} output="normal" media={media} logo={null} aspect={aspect} className="absolute inset-0 overflow-hidden" />
                        </div>
                        <span className="text-sm text-muted">{lines[0] ?? slide.label}</span>
                      </div>
                    ) : (
                      lines.map((line, i) => (
                        <p key={i} className="text-[15px] leading-relaxed text-text">
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                  {active && onAir && <span className="mt-0.5 shrink-0 rounded bg-live px-1.5 text-[10px] font-bold text-white">LIVE</span>}
                  {next && <span className="mt-0.5 shrink-0 rounded bg-primary px-1.5 text-[10px] font-bold text-white">NEXT</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
    </>
  );
}

/** Slides without words, which keep a small picture in the list. */
const WORDLESS = new Set<Slide["content"]["kind"]>(["media", "blank", "web"]);
