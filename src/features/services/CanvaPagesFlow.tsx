import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileUp, Loader2 } from "lucide-react";
import type { DeckCategory } from "@/types/generated/DeckCategory";
import type { SlideDeck } from "@/types/generated/SlideDeck";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { MAX_CANVA_PAGES } from "@/lib/service-items";
import { Dialog } from "@/components/ui/Dialog";
import { canvaViewUrl } from "@/lib/canva";
import { openExternal, pickFile } from "@/lib/files";
import { errorMessage } from "@/lib/ipc";
import { importPresentation, PRESENTATION_EXTENSIONS, type ImportProgress } from "@/lib/import/presentation";

type Stage = { stage: "idle" } | { stage: "waiting"; since: number } | { stage: "importing"; progress: ImportProgress } | { stage: "error"; message: string };

/** "Palm Sunday - Pstr. Weldon (1).pdf" and "Palm Sunday – Pstr Weldon" compare as the same name. */
const simple = (s: string) =>
  s
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const WAIT_MS = 15 * 60_000;

/**
 * Brings every page of a Canva design in as picture slides, like a PDF
 * import: the design opens in the browser, the operator downloads it as PDF
 * from Canva, and the new file is picked up from the Downloads folder.
 * (Canva shows a live design as one page and lets no other app turn its
 * pages, so pages come in through Canva's own Download.)
 */
export function CanvaPagesFlow({
  link,
  category,
  onImported,
}: {
  link: string;
  /** Library category of the new slide deck. */
  category?: DeckCategory;
  onImported: (deck: SlideDeck, warnings: string[], designTitle: string | null) => void;
}) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["canva-info", link], queryFn: () => api.files.canvaInfo(link), retry: false, staleTime: Infinity });
  const [state, setState] = useState<Stage>({ stage: "idle" });
  const [others, setOthers] = useState<{ path: string; name: string }[]>([]);
  const title = info.data?.title || null;
  const viewUrl = info.data?.viewUrl ?? canvaViewUrl(link);
  const busy = useRef(false);

  const importFile = useCallback(
    async (path: string) => {
      if (busy.current) return;
      busy.current = true;
      setState({ stage: "importing", progress: { message: "Starting…" } });
      try {
        const { deck, warnings } = await importPresentation(path, (progress) => setState({ stage: "importing", progress }), category);
        void qc.invalidateQueries({ queryKey: ["decks"] });
        setState({ stage: "idle" });
        onImported(deck, warnings, title);
      } catch (e) {
        setState({ stage: "error", message: errorMessage(e) });
      } finally {
        busy.current = false;
      }
    },
    [onImported, qc, title, category],
  );

  // While waiting, look for the downloaded file every moment.
  const since = state.stage === "waiting" ? state.since : null;
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(async () => {
      if (Date.now() - since > WAIT_MS) {
        clearInterval(timer);
        setState({ stage: "error", message: "No download arrived. Use “Choose the downloaded file…” instead." });
        return;
      }
      const files = await api.files.newDownloads(since).catch(() => []);
      const match = title ? files.find((f) => simple(f.name).startsWith(simple(title))) : files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (match) {
        clearInterval(timer);
        void importFile(match.path);
      } else {
        setOthers(files);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [since, title, importFile]);

  const open = async () => {
    if (!viewUrl) return;
    setOthers([]);
    setState({ stage: "waiting", since: Date.now() });
    await openExternal(viewUrl).catch((e) => setState({ stage: "error", message: errorMessage(e) }));
  };

  const chooseYourself = async () => {
    const path = await pickFile({ title: "Choose the file downloaded from Canva", filters: [{ name: "PDF, PowerPoint or ZIP", extensions: PRESENTATION_EXTENSIONS }] });
    if (path) void importFile(path);
  };

  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1.5 pl-5 text-muted">
        <li>
          <Button size="sm" variant="primary" icon={<ExternalLink className="size-3.5" />} onClick={() => void open()} disabled={!viewUrl || state.stage === "importing"}>
            Open {title ? `“${title}”` : "the design"} in Canva
          </Button>
        </li>
        <li>
          In Canva choose <strong>Share → Download</strong>, set <strong>File type: PDF Standard</strong>, and press <strong>Download</strong>. (If Download is missing, open the
          design in Canva's editor, or ask its owner to download it.)
        </li>
        <li>SanctuaryFlow finds the file in your Downloads folder and makes every page a slide.</li>
      </ol>
      {state.stage === "waiting" && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3" role="status">
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Waiting for {title ? `“${title}.pdf”` : "the PDF"} in your Downloads folder…
          </p>
          {others.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted">Other new downloads:</p>
              {others.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <Button size="sm" onClick={() => void importFile(f.path)}>
                    Use this file
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {state.stage === "importing" && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3" role="status">
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {state.progress.message}
          </p>
          {state.progress.total ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-elevated">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${(100 * (state.progress.done ?? 0)) / state.progress.total}%` }} />
            </div>
          ) : null}
        </div>
      )}
      {state.stage === "error" && (
        <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-muted selectable" role="alert">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<FileUp className="size-3.5" />} onClick={() => void chooseYourself()} disabled={state.stage === "importing"}>
          Choose the downloaded file…
        </Button>
        {info.isSuccess && (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <CheckCircle2 className="size-3.5 text-success" /> Found on Canva
          </span>
        )}
      </div>
    </div>
  );
}

/** The Canva link of an item shown live, or brought in page by page. */
export function canvaLinkOf(settings: Record<string, unknown> | null | undefined): { link: string; brought: boolean } | null {
  if (!settings) return null;
  if (typeof settings.canvaUrl === "string") return { link: settings.canvaUrl, brought: false };
  if (typeof settings.canvaSource === "string") return { link: settings.canvaSource, brought: true };
  return null;
}

/** An item's settings after its Canva pages were brought in: slides, remembering the link for updates. */
export function withCanvaPages<T extends { refId: string | null; settings: Record<string, unknown> }>(item: T, deckId: string, link: string): T {
  const { canvaUrl: _live, canvaPages: _pages, canvaPictures: _pictures, canvaAspect: _aspect, ...rest } = item.settings ?? {};
  return { ...item, refId: deckId, settings: { ...rest, canvaSource: link } };
}

export function CanvaPagesDialog({
  open,
  onClose,
  title,
  link,
  update,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  link: string;
  update: boolean;
  onImported: (deck: SlideDeck, warnings: string[]) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={update ? `Update “${title}” from Canva` : `Every page of “${title}” as a slide`}
      description={
        update
          ? "Download the design again after changing it in Canva; its slides are replaced with the new pages."
          : "All pages appear as slides, Next moves through them, and the output and its preview always show the same page. Works offline afterwards."
      }
    >
      {open && <CanvaPagesFlow link={link} onImported={(deck, warnings) => onImported(deck, warnings)} />}
    </Dialog>
  );
}

/** "How many pages?" for a live Canva design; commits when it changes and is valid. */
export function CanvaPageCount({ value, onChange, compact }: { value: number; onChange: (pages: number) => void; compact?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= 1 && n <= MAX_CANVA_PAGES) {
      if (n !== value) onChange(n);
    } else {
      setText(String(value));
    }
  };
  const input = (
    <Input
      type="number"
      min={1}
      max={MAX_CANVA_PAGES}
      aria-label="Number of Canva pages"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={compact ? "h-8 w-16 text-xs" : "w-28"}
    />
  );
  return compact ? (
    <label className="flex items-center gap-1.5 text-xs text-muted" title="Canva shows the count at the bottom of the design, for example “1 / 14”">
      Pages {input}
    </label>
  ) : (
    <Field label="Number of pages" hint="Canva shows it at the bottom of the design, for example “1 / 14”. Next turns the pages and stops on the last one.">
      {input}
    </Field>
  );
}
