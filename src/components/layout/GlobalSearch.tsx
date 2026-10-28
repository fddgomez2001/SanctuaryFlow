import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarDays, CornerDownLeft, MonitorPlay, Music, Search } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { create } from "zustand";
import { navigate, type PageId } from "@/app/navigation";
import { api } from "@/services/api";
import { setting, useSettings } from "@/hooks/useSettings";
import { parseReference } from "@/lib/bible/reference";
import { referenceBooks } from "@/lib/bible/canon";
import { presentScripture, presentSong } from "@/services/presentation-engine/quick";
import { defaultSongQuery } from "@/features/songs/query";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/misc";

export const useGlobalSearch = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Result {
  key: string;
  icon: React.ReactNode;
  title: string;
  detail?: string;
  run: () => void;
  present?: () => void;
}

const pages: { id: PageId; title: string }[] = [
  { id: "home", title: "Home" },
  { id: "live", title: "Live Presentation" },
  { id: "services", title: "Service Planner" },
  { id: "songs", title: "Song Library" },
  { id: "bible", title: "Bible Library" },
  { id: "slides", title: "Slide Editor" },
  { id: "media", title: "Media Library" },
  { id: "themes", title: "Presentation Themes" },
  { id: "import-export", title: "Import & Export" },
  { id: "backup", title: "Backup & Restore" },
  { id: "sync", title: "Synchronization" },
  { id: "settings", title: "Settings" },
];

export function GlobalSearch() {
  const { open, setOpen } = useGlobalSearch();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const settings = useSettings();
  const translationId = setting<string | null>(settings.data, "bible.defaultTranslationId", null);
  const input = useRef<HTMLInputElement>(null);
  const q = text.trim();

  const songs = useQuery({
    queryKey: ["global-search-songs", q],
    queryFn: () => api.songs.list({ ...defaultSongQuery(), text: q, sort: "relevance", limit: 6 }),
    enabled: open && q.length >= 2,
  });
  const services = useQuery({
    queryKey: ["global-search-services", q],
    queryFn: () => api.services.list({ text: q, status: null, templates: false, fromDate: null, toDate: null, sort: "dateDesc", limit: 4 }),
    enabled: open && q.length >= 2,
  });

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];
    if (q) {
      const ref = parseReference(q, referenceBooks());
      if (ref.ok) {
        out.push({
          key: "ref",
          icon: <BookOpen />,
          title: ref.display,
          detail: translationId ? "Open in the Bible library" : "Install a Bible translation to present Scripture",
          run: () => void navigate("bible", { reference: ref.display }),
          ...(translationId ? { present: () => void presentScripture(translationId, [ref.ref], ref.display) } : {}),
        });
      }
    }
    for (const s of songs.data?.items ?? []) {
      out.push({
        key: `song-${s.id}`,
        icon: <Music />,
        title: s.title,
        detail: [s.artist, s.firstLine].filter(Boolean).join(" · "),
        run: () => void navigate("songs", { songId: s.id }),
        present: () => void presentSong(s),
      });
    }
    for (const p of services.data ?? []) {
      out.push({ key: `svc-${p.id}`, icon: <CalendarDays />, title: p.title, detail: p.serviceDate ?? undefined, run: () => void navigate("services", { planId: p.id }) });
    }
    for (const p of pages.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 12)) {
      out.push({ key: `page-${p.id}`, icon: <MonitorPlay />, title: p.title, detail: "Go to page", run: () => void navigate(p.id) });
    }
    return out;
  }, [q, songs.data, services.data, translationId]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const choose = (r: Result | undefined, present: boolean) => {
    if (!r) return;
    setOpen(false);
    if (present && r.present) r.present();
    else r.run();
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content
          data-shortcuts="off"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
          className="fixed top-[14vh] left-1/2 z-50 w-[640px] max-w-[calc(100vw-48px)] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        >
          <D.Title className="sr-only">Search</D.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-subtle" />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(results[active], e.ctrlKey || e.shiftKey);
                }
              }}
              placeholder="Search songs, services, pages — or type a reference like John 3:16"
              className="h-12 flex-1 bg-transparent text-sm text-text placeholder:text-subtle focus:outline-none"
              aria-label="Search"
            />
          </div>
          <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches.</li>}
            {results.map((r, i) => (
              <li key={r.key} role="option" aria-selected={i === active}>
                <div
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex items-center gap-3 rounded-md px-3 py-2", i === active ? "bg-elevated" : "")}
                >
                  <span className="text-subtle [&>svg]:size-4">{r.icon}</span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => choose(r, false)}>
                    <p className="truncate text-sm text-text">{r.title}</p>
                    {r.detail && <p className="truncate text-xs text-subtle">{r.detail}</p>}
                  </button>
                  {r.present && (
                    <button
                      type="button"
                      onClick={() => choose(r, true)}
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:border-primary hover:text-text"
                    >
                      Present
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-subtle">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>{" "}
              open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> present now
            </span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
