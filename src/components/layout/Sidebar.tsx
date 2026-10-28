import {
  Archive,
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  Cloud,
  House,
  Image,
  MonitorPlay,
  Music,
  Palette,
  Presentation,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { navigate, useNav, type PageId } from "@/app/navigation";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";

const items: { id: PageId; label: string; icon: ReactNode; group: number }[] = [
  { id: "home", label: "Home", icon: <House />, group: 0 },
  { id: "live", label: "Live Presentation", icon: <MonitorPlay />, group: 0 },
  { id: "services", label: "Service Planner", icon: <CalendarDays />, group: 1 },
  { id: "songs", label: "Song Library", icon: <Music />, group: 1 },
  { id: "bible", label: "Bible Library", icon: <BookOpen />, group: 1 },
  { id: "slides", label: "Slide Editor", icon: <Presentation />, group: 1 },
  { id: "media", label: "Media Library", icon: <Image />, group: 1 },
  { id: "themes", label: "Presentation Themes", icon: <Palette />, group: 1 },
  { id: "import-export", label: "Import & Export", icon: <ArrowLeftRight />, group: 2 },
  { id: "backup", label: "Backup & Restore", icon: <Archive />, group: 2 },
  { id: "sync", label: "Synchronization", icon: <Cloud />, group: 2 },
  { id: "settings", label: "Settings", icon: <Settings />, group: 2 },
];

export function Sidebar() {
  const page = useNav((s) => s.page);
  const projectorOpen = useLive((s) => s.projector.open);
  const live = useLive((s) => s.engine.live !== null && s.engine.output === "normal");
  return (
    <nav aria-label="Main" className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <img src="/LOGO.png" alt="SanctuaryFlow logo" className="size-9 object-contain" />
        <div>
          <p className="text-sm leading-4 font-semibold">SanctuaryFlow</p>
          <p className="text-[11px] text-subtle">Worship presentation</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {items.map((item, i) => (
          <li key={item.id}>
            {i > 0 && items[i - 1]!.group !== item.group && <div className="mx-2 my-2 border-t border-border" />}
            <button
              type="button"
              onClick={() => void navigate(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
                page === item.id
                  ? "bg-primary font-medium text-white shadow-sm"
                  : "text-muted hover:bg-elevated hover:text-text [&>svg]:text-primary",
              )}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.id === "live" && projectorOpen && (
                <span className={cn("rounded px-1.5 text-[10px] font-semibold", live ? "bg-live text-white" : "bg-elevated text-muted")}>
                  {live ? "LIVE" : "ON"}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
