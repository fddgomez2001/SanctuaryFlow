import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, FileUp, Globe, Loader2 } from "lucide-react";
import type { ServiceItemInput } from "@/types/generated/ServiceItemInput";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { errorMessage } from "@/lib/ipc";
import { pickFile } from "@/lib/files";
import { parseCanvaLink } from "@/lib/canva";
import { importPresentation, POWERPOINT_EXTENSIONS, PRESENTATION_EXTENSIONS, type ImportProgress } from "@/lib/import/presentation";
import { cn } from "@/lib/cn";
import { CanvaPageCount, CanvaPagesFlow } from "./CanvaPagesFlow";

type State = { stage: "idle" } | { stage: "working"; progress: ImportProgress } | { stage: "error"; message: string };

export type NewItem = Omit<ServiceItemInput, "id">;

/**
 * Brings a finished presentation into the service: PowerPoint, PDF (from
 * Canva, Google Slides, Keynote…), a ZIP of pictures or single pictures, or
 * a public Canva design shown live from its link.
 */
export function ImportPresentationDialog({
  open,
  onClose,
  onAdd,
  itemType = "custom",
  extraAction,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new service item and a confirmation message. */
  onAdd: (item: NewItem, message: string, detail?: string) => void;
  /** Sermon slides are kept with the sermon slides in the library. */
  itemType?: "custom" | "sermon";
  /** Another way to add the item, offered in the footer. */
  extraAction?: { label: string; onClick: () => void };
}) {
  const sermon = itemType === "sermon";
  const qc = useQueryClient();
  const [state, setState] = useState<State>({ stage: "idle" });
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [canvaMode, setCanvaMode] = useState<"pages" | "live">("pages");
  const [canvaPages, setCanvaPages] = useState(1);
  const powerpoint = useQuery({ queryKey: ["powerpoint-available"], queryFn: api.files.powerpointAvailable, staleTime: Infinity, enabled: open });
  useEffect(() => {
    if (!open) return;
    setState({ stage: "idle" });
    setLink("");
    setName("");
    setLinkError(null);
    setCanvaMode("pages");
    setCanvaPages(1);
  }, [open]);
  const working = state.stage === "working";

  const choose = async () => {
    const path = await pickFile({
      title: "Choose a presentation",
      filters: [
        { name: "Presentations, PDF and pictures", extensions: PRESENTATION_EXTENSIONS },
        { name: "PowerPoint", extensions: POWERPOINT_EXTENSIONS },
        { name: "PDF", extensions: ["pdf"] },
      ],
    });
    if (!path) return;
    setState({ stage: "working", progress: { message: "Starting…" } });
    try {
      const { deck, warnings } = await importPresentation(path, (progress) => setState({ stage: "working", progress }), itemType);
      void qc.invalidateQueries({ queryKey: ["decks"] });
      setState({ stage: "idle" });
      onAdd(
        { itemType, title: deck.title, refId: deck.id, settings: {}, notes: null },
        `“${deck.title}” was added with ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}`,
        warnings.join(" ") || undefined,
      );
    } catch (e) {
      setState({ stage: "error", message: errorMessage(e) });
    }
  };

  const parsed = parseCanvaLink(link);
  const canvaTitle = useQuery({
    queryKey: ["canva-info", parsed.ok ? parsed.embedUrl : ""],
    queryFn: () => api.files.canvaInfo(parsed.ok ? parsed.embedUrl : ""),
    enabled: open && parsed.ok,
    retry: false,
    staleTime: Infinity,
  });
  const addCanva = () => {
    if (!parsed.ok) {
      setLinkError(parsed.error);
      return;
    }
    const title = name.trim() || canvaTitle.data?.title || "Canva design";
    const size = canvaTitle.data;
    const canvaAspect = size?.width && size.height ? size.width / size.height : undefined;
    onAdd(
      { itemType, title, refId: null, settings: { canvaUrl: parsed.embedUrl, canvaPages, ...(canvaAspect ? { canvaAspect } : {}) }, notes: null },
      `“${title}” was added. It is shown live from Canva.`,
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !working && onClose()}
      dismissable={!working}
      size="lg"
      title={sermon ? "Add sermon slides" : "Add a presentation"}
      description={sermon ? "Import the sermon's PowerPoint or PDF, or bring it in from a Canva link." : "Import a file, or bring in a Canva design from its link."}
      footer={
        <>
          {extraAction && (
            <Button variant="secondary" className="mr-auto" onClick={extraAction.onClick} disabled={working}>
              {extraAction.label}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Close
          </Button>
        </>
      }
    >
      <div className="grid gap-5 text-sm md:grid-cols-2">
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <FileUp className="size-4 text-primary" /> Import a file
          </h3>
          <p className="text-muted">Each slide or page becomes a picture slide, so it looks exactly as it was designed. The pictures stay with the slides and are not added to the Media Library.</p>
          <ul className="space-y-2">
            <li className="flex gap-2">
              {powerpoint.data ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              <span>
                <strong>PowerPoint (.pptx, .ppt)</strong> —{" "}
                {powerpoint.isLoading
                  ? "checking for PowerPoint…"
                  : powerpoint.data
                    ? "PowerPoint is installed, so slides are converted exactly. Hidden slides are left out and speaker notes are kept."
                    : "needs Microsoft PowerPoint on this computer. Without it, save the presentation as PDF and import the PDF."}
              </span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <strong>PDF</strong> — from Canva (Share → Download → PDF Standard), Google Slides (File → Download → PDF) or Keynote. Works on every computer, offline.
              </span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <strong>Pictures</strong> — a .png or .jpg, or a .zip of pictures (used in file-name order).
              </span>
            </li>
          </ul>
          <Button variant="primary" icon={working ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} onClick={() => void choose()} disabled={working}>
            Choose file…
          </Button>
          {state.stage === "working" && (
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
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3" role="alert">
              <p className="font-medium text-text">The presentation could not be imported</p>
              <p className="mt-1 text-muted selectable">{state.message}</p>
            </div>
          )}
        </section>

        <section className="space-y-3 md:border-l md:border-border md:pl-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Globe className="size-4 text-primary" /> From a Canva link
          </h3>
          <p className="text-muted">
            In Canva choose <strong>Share</strong>, set access to <strong>Anyone with the link</strong>, copy the link and paste it here.
          </p>
          <Field label="Canva link" error={linkError ?? undefined}>
            <Input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(null);
              }}
              onBlur={() => link.trim() && !parsed.ok && setLinkError(parsed.error)}
              placeholder="https://www.canva.com/design/…"
            />
          </Field>
          <Field label="Name in the service">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={canvaTitle.data?.title || "Canva design"} />
          </Field>
          {parsed.ok && (
            <>
              <div className="flex gap-1 rounded-md bg-bg p-0.5" role="tablist" aria-label="How to show it">
                {(
                  [
                    ["pages", "Every page as a slide"],
                    ["live", "Live from Canva"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={canvaMode === id}
                    onClick={() => setCanvaMode(id)}
                    className={cn("flex-1 rounded px-2 py-1 text-xs", canvaMode === id ? "bg-elevated font-semibold text-text shadow-sm" : "text-muted hover:text-text")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {canvaMode === "pages" ? (
                <>
                  <p className="text-xs text-subtle">
                    Recommended for presentations: all pages appear as slides, Next moves through them, the output and its preview always show the same page, and it works
                    offline.
                  </p>
                  <CanvaPagesFlow
                    link={parsed.embedUrl}
                    category={itemType}
                    onImported={(deck, warnings, designTitle) => {
                      const title = name.trim() || designTitle || deck.title;
                      onAdd(
                        { itemType, title, refId: deck.id, settings: { canvaSource: parsed.embedUrl }, notes: null },
                        `“${title}” was added with ${deck.slides.length} page${deck.slides.length === 1 ? "" : "s"} from Canva`,
                        warnings.join(" ") || undefined,
                      );
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="text-xs text-subtle">
                    Shows the design itself, so changes made in Canva appear by themselves. Each page is a slide: Next and the arrow keys turn the pages on the output and
                    its preview together. It needs the internet during the service.
                  </p>
                  <CanvaPageCount value={canvaPages} onChange={setCanvaPages} />
                  <Button icon={<Globe className="size-4" />} onClick={addCanva}>
                    Add Canva design ({canvaPages} page{canvaPages === 1 ? "" : "s"})
                  </Button>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
