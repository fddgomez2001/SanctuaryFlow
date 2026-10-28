import type { Slide } from "@/lib/slides/types";
import type { ThemeSettings } from "@/lib/theme";
import type { MediaRef } from "@/services/presentation-engine/render-model";
import { slideColor } from "@/lib/slides/colors";
import { SlideRenderer } from "./SlideRenderer";
import { cn } from "@/lib/cn";

/** A clickable slide preview with its label underneath. */
export function SlideThumb({
  slide,
  theme,
  media,
  aspect = 16 / 9,
  active,
  next,
  onClick,
  onDoubleClick,
  index,
  onAir = true,
}: {
  slide: Slide;
  theme: ThemeSettings;
  media: Record<string, MediaRef>;
  aspect?: number;
  active?: boolean;
  next?: boolean;
  /** Off air the chosen slide is only highlighted in gold, without LIVE. */
  onAir?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  index?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-current={active ? "true" : undefined}
      aria-label={`${index !== undefined ? `Slide ${index + 1}: ` : ""}${slide.label}${active ? (onAir ? " (on screen)" : " (chosen)") : ""}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-md border-2 bg-bg text-left transition-colors",
        active && onAir ? "border-live" : active ? "border-primary ring-2 ring-primary/30" : next ? "border-primary/70" : "border-border hover:border-primary/60",
      )}
    >
      <div className="relative w-full" style={{ aspectRatio: aspect }}>
        <SlideRenderer
          content={slide.content}
          slideKey={slide.id}
          theme={theme}
          output="normal"
          media={media}
          logo={null}
          aspect={aspect}
          className="absolute inset-0 overflow-hidden"
        />
        {active && onAir && <span className="absolute top-1 left-1 rounded bg-live px-1.5 text-[10px] font-bold text-white">LIVE</span>}
        {!active && next && <span className="absolute top-1 left-1 rounded bg-primary px-1.5 text-[10px] font-bold text-white">NEXT</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1">
        {index !== undefined && <span className="text-[11px] text-subtle">{index + 1}</span>}
        <SlideLabel slide={slide} />
      </div>
    </button>
  );
}

/** The slide's label, coloured by song part (verse, chorus, bridge…). */
export function SlideLabel({ slide }: { slide: Slide }) {
  const color = slideColor(slide);
  return color ? (
    <span className="truncate rounded px-1.5 text-xs leading-[18px] font-medium text-white" style={{ backgroundColor: color }}>
      {slide.label}
    </span>
  ) : (
    <span className="truncate text-xs text-muted group-hover:text-text">{slide.label}</span>
  );
}
