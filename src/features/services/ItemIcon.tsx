import type { ReactNode } from "react";
import { BookOpen, Film, Globe, Heading, Image as ImageIcon, Megaphone, Music, Presentation, Square, Type } from "lucide-react";
import type { ItemKind } from "@/lib/service-items";
import { cn } from "@/lib/cn";

/** A tile per kind of item in a shade of the interface's gold (or navy); the icon tells them apart. */
const KINDS: Record<ItemKind, { icon: ReactNode; color: string }> = {
  song: { icon: <Music />, color: "#b0842a" },
  scripture: { icon: <BookOpen />, color: "#8a6417" },
  announcement: { icon: <Megaphone />, color: "#1f2d4d" },
  sermon: { icon: <Presentation />, color: "#9c6b30" },
  presentation: { icon: <Presentation />, color: "#a8692a" },
  canva: { icon: <Globe />, color: "#6e5a2e" },
  custom: { icon: <Type />, color: "#6b6152" },
  image: { icon: <ImageIcon />, color: "#7a5410" },
  video: { icon: <Film />, color: "#4f3d17" },
  heading: { icon: <Heading />, color: "#8a8170" },
  blank: { icon: <Square />, color: "#2a2620" },
};

/** The colour that marks a kind of item. */
export function kindColor(kind: ItemKind): string {
  return KINDS[kind].color;
}

export function ItemIcon({ kind, icon, className }: { kind: ItemKind; icon?: ReactNode; className?: string }) {
  const k = KINDS[kind];
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white shadow-sm [&>svg]:size-4", className)}
      style={{ backgroundColor: k.color }}
    >
      {icon ?? k.icon}
    </span>
  );
}
