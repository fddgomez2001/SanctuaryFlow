import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Check, CircleAlert, Copy, FileDown, FileUp, LayoutTemplate, Loader2, MonitorPlay, Music, Pencil, Trash2 } from "lucide-react";
import type { ServiceItemInput } from "@/types/generated/ServiceItemInput";
import type { ServicePlanDocument } from "@/types/generated/ServicePlanDocument";
import { api } from "@/services/api";
import { navigate, useUnsavedGuard } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { confirm } from "@/components/ui/Dialog";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/misc";
import { DragHandle, SortableList } from "@/components/ui/SortableList";
import { toast } from "@/components/ui/Toast";
import { newId } from "@/lib/slides/deck";
import { ITEM_KIND_LABELS, itemKind, type ItemKind } from "@/lib/service-items";
import { formatServiceDate } from "@/lib/format";
import { ItemIcon, kindColor } from "./ItemIcon";
import { errorMessage } from "@/lib/ipc";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";
import { planToDocument } from "./model";
import { DeckPickerDialog, MediaPickerDialog, ScripturePickerDialog, SongPickerDialog } from "./pickers";
import { ItemInspector } from "./ItemInspector";
import { ImportPresentationDialog } from "./ImportPresentationDialog";
import { exportService } from "./ServicesPage";
import { ServiceDateTile, ServiceDetailsDialog } from "./ServiceDetailsDialog";

type Picker = null | "song" | "scripture" | "announcement" | "sermon" | "custom" | "image" | "video";
type AddAction = Exclude<Picker, null> | "heading" | "blank" | "import";

/** The "Add to service" tiles, most used first. */
const ADD_TILES: { action: AddAction; label: string; kind: ItemKind; icon?: React.ReactNode; hint: string }[] = [
  { action: "song", label: "Song", kind: "song", hint: "A song from the Song Library" },
  { action: "scripture", label: "Scripture", kind: "scripture", hint: "A Bible passage" },
  { action: "sermon", label: "Sermon slides", kind: "sermon", hint: "PowerPoint, PDF or a Canva link" },
  { action: "announcement", label: "Announcement", kind: "announcement", hint: "Announcement slides or plain text" },
  { action: "import", label: "Import / Canva", kind: "presentation", icon: <FileUp />, hint: "PowerPoint, PDF, pictures or a Canva link" },
  { action: "custom", label: "Custom slides", kind: "custom", hint: "Slides made in the Slide Editor" },
  { action: "image", label: "Image", kind: "image", hint: "A picture from the Media Library" },
  { action: "video", label: "Video", kind: "video", hint: "A video from the Media Library" },
  { action: "heading", label: "Heading", kind: "heading", hint: "A section title in the order (not shown on screen)" },
  { action: "blank", label: "Blank", kind: "blank", hint: "An empty slide with the theme background" },
];

type SaveState = "saved" | "pending" | "saving" | "error";

export function ServiceEditor({ planId, returnTo }: { planId: string; returnTo?: "live" }) {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["service", planId], queryFn: () => api.services.get(planId), staleTime: Infinity });
  const [draft, setDraft] = useState<ServicePlanDocument | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [importing, setImporting] = useState<false | "custom" | "sermon">(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const live = useLive();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (plan.data && !draft) {
      const doc = planToDocument(plan.data);
      setDraft(doc);
      setSaved(JSON.stringify(doc));
      setSelected(doc.items[0]?.id ?? null);
      void api.services.markOpened(planId).catch(() => undefined);
    }
  }, [plan.data, draft, planId]);

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  useUnsavedGuard(dirty && saveState === "error", "The latest changes to this service could not be saved.");

  const persist = useCallback(
    async (doc: ServicePlanDocument) => {
      if (saving.current) return;
      saving.current = true;
      setSaveState("saving");
      try {
        const result = await api.services.save(doc);
        const savedDoc = planToDocument(result);
        setSaved(JSON.stringify(savedDoc));
        setSaveState("saved");
        setSaveError(null);
        qc.setQueryData(["service", planId], result);
        void qc.invalidateQueries({ queryKey: ["services"] });
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
        if (useLive.getState().serviceId === planId) void useLive.getState().refresh();
      } catch (e) {
        setSaveState("error");
        setSaveError(errorMessage(e));
      } finally {
        saving.current = false;
      }
    },
    [planId, qc],
  );

  // Auto-save shortly after each change.
  useEffect(() => {
    if (!draft || !dirty) return;
    setSaveState((s) => (s === "error" ? s : "pending"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(draft), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, dirty, persist]);

  // Save immediately when leaving the editor.
  const latest = useRef(draft);
  latest.current = draft;
  const latestSaved = useRef(saved);
  latestSaved.current = saved;
  useEffect(
    () => () => {
      const d = latest.current;
      if (d && JSON.stringify(d) !== latestSaved.current) void api.services.save(d).catch(() => undefined);
    },
    [],
  );

  const items = draft?.items ?? [];
  const selectedItem = items.find((i) => i.id === selected) ?? null;
  const update = (patch: Partial<ServicePlanDocument>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setItems = (next: ServiceItemInput[]) => update({ items: next });
  const addItem = (item: Omit<ServiceItemInput, "id">) => {
    const withId = { ...item, id: newId() };
    const idx = selectedItem ? items.findIndex((i) => i.id === selectedItem.id) + 1 : items.length;
    setItems([...items.slice(0, idx), withId, ...items.slice(idx)]);
    setSelected(withId.id);
    setPicker(null);
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next);
  };

  const present = async (fromItemId: string | null) => {
    if (draft && dirty) await persist(draft);
    await live.loadService(planId);
    const s = useLive.getState();
    const idx = fromItemId ? s.engine.items.findIndex((i) => i.id === fromItemId) : s.engine.items.findIndex((i) => i.slides.length > 0);
    if (idx >= 0) {
      if (s.engine.items[idx]!.slides.length) s.dispatch({ type: "goLive", itemIndex: idx, slideIndex: 0 });
      else s.dispatch({ type: "select", itemIndex: idx });
    }
    void navigate("live");
  };

  if (plan.isLoading || (!draft && !plan.isError)) return <LoadingBlock />;
  if (plan.isError || !draft) {
    return (
      <div className="p-6">
        <ErrorNotice title="The service could not be opened" message={String(plan.error ?? "")} action={<Button onClick={() => void navigate("services")}>Back to services</Button>} />
      </div>
    );
  }

  const add = (action: AddAction) => {
    if (action === "heading") addItem({ itemType: "heading", title: "New section", refId: null, settings: {}, notes: null });
    else if (action === "blank") addItem({ itemType: "blank", title: "Blank", refId: null, settings: { mode: "theme" }, notes: null });
    else if (action === "import") setImporting("custom");
    // Sermon slides usually arrive as a PowerPoint, PDF or Canva design.
    else if (action === "sermon") setImporting("sermon");
    else setPicker(action);
  };
  let number = 0;
  const numbers = new Map(items.filter((i) => i.itemType !== "heading").map((i) => [i.id, ++number]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
        {returnTo === "live" ? (
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => void navigate("live")}>
            Back to Live Presentation
          </Button>
        ) : (
          <IconButton label="Back to services" icon={<ArrowLeft className="size-4" />} onClick={() => void navigate("services")} />
        )}
        <ServiceDateTile date={draft.serviceDate} isTemplate={draft.isTemplate} />
        <div className="min-w-0">
          <h1 className="max-w-[28rem] truncate text-lg leading-tight font-semibold" title={draft.title}>
            {draft.title || "Untitled service"}
          </h1>
          <p className="text-xs text-muted">{draft.isTemplate ? "Template" : formatServiceDate(draft.serviceDate)}</p>
        </div>
        <IconButton size="sm" label="Edit service details" icon={<Pencil className="size-3.5" />} onClick={() => setEditingDetails(true)} />
        <SaveIndicator state={saveState} error={saveError} onRetry={() => void persist(draft)} />
        <div className="ml-auto flex gap-1.5">
          {!draft.isTemplate && (
            <>
              <Button variant="live" icon={<MonitorPlay className="size-4" />} onClick={() => void present(null)} disabled={items.length === 0}>
                Present from start
              </Button>
              <Button icon={<MonitorPlay className="size-4" />} onClick={() => void present(selected)} disabled={!selectedItem}>
                From selected
              </Button>
            </>
          )}
          <IconButton
            label={draft.isTemplate ? "New service from this template" : "Save as template"}
            icon={<LayoutTemplate className="size-4" />}
            onClick={async () => {
              try {
                const copy = await api.services.duplicate(planId, { title: null, asTemplate: !draft.isTemplate, serviceDate: null });
                void qc.invalidateQueries({ queryKey: ["services"] });
                toast.success(draft.isTemplate ? "Service created from template" : "Template saved");
                if (draft.isTemplate) void navigate("services", { planId: copy.id });
              } catch (e) {
                toast.error("Could not copy the service", e);
              }
            }}
          />
          <IconButton label="Export service" icon={<FileDown className="size-4" />} onClick={() => void exportService(planId, draft.title)} />
          <IconButton
            label="Delete service"
            icon={<Trash2 className="size-4" />}
            onClick={async () => {
              if (!(await confirm({ title: "Delete this service?", message: "The plan is removed. Songs and slides it uses are kept.", confirmLabel: "Delete", danger: true }))) return;
              try {
                await api.services.remove(planId);
                setSaved(JSON.stringify(draft));
                void qc.invalidateQueries({ queryKey: ["services"] });
                void navigate("services");
              } catch (e) {
                toast.error("Could not delete the service", e);
              }
            }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[468px] shrink-0 flex-col border-r border-border bg-bg">
          <div className="border-b border-border bg-panel px-3 pt-2.5 pb-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Add to service</p>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Add to service">
              {ADD_TILES.map((t) => (
                <button
                  key={t.action}
                  type="button"
                  title={t.hint}
                  onClick={() => add(t.action)}
                  className="flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-panel px-1 py-2 text-center text-[11px] leading-tight font-medium text-text transition hover:-translate-y-px hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
                >
                  <ItemIcon kind={t.kind} icon={t.icon} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <p className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Order of service</p>
            <p className="text-[11px] text-subtle">
              {numbers.size} item{numbers.size === 1 ? "" : "s"}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {items.length === 0 && (
              <EmptyState icon={<Music />} title="This service is empty" description="Use the buttons above to add songs, Scripture, sermon slides and media." />
            )}
            <SortableList
              items={items}
              getId={(i) => i.id!}
              onReorder={setItems}
              className="space-y-1.5"
              render={(item, handle, dragging) =>
                item.itemType === "heading" ? (
                  <div
                    className={cn("group flex items-center gap-2 rounded-md px-1 pt-3 pb-1", selected === item.id && "bg-primary/10", dragging && "bg-elevated")}
                    onClick={() => setSelected(item.id!)}
                  >
                    <DragHandle handle={handle} />
                    <span className="text-xs font-bold tracking-wider text-muted uppercase">{item.title}</span>
                    <span className="h-px flex-1 bg-border" aria-hidden />
                    <RowActions id={item.id!} onMove={move} onRemove={() => setItems(items.filter((i) => i.id !== item.id))} />
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(item.id!)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(item.id!)}
                    className={cn(
                      "group relative flex items-center gap-2 overflow-hidden rounded-lg border bg-panel py-2 pr-1 pl-2.5 transition-shadow",
                      selected === item.id ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-border-strong hover:shadow-sm",
                      dragging && "shadow-lg",
                    )}
                  >
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: kindColor(itemKind(item)) }} />
                    <DragHandle handle={handle} />
                    <span className="w-5 shrink-0 text-right text-xs text-subtle tabular-nums">{numbers.get(item.id)}</span>
                    <ItemIcon kind={itemKind(item)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-[11px] text-subtle">{ITEM_KIND_LABELS[itemKind(item)]}{item.notes ? ` · ${item.notes}` : ""}</p>
                    </div>
                    <RowActions
                      id={item.id!}
                      onMove={move}
                      onDuplicate={() => {
                        const idx = items.findIndex((i) => i.id === item.id);
                        const copy = { ...item, id: newId() };
                        setItems([...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)]);
                        setSelected(copy.id);
                      }}
                      onRemove={() => {
                        setItems(items.filter((i) => i.id !== item.id));
                        if (selected === item.id) setSelected(null);
                      }}
                    />
                  </div>
                )
              }
            />
          </div>
          <div className="border-t border-border bg-panel p-2">
            <textarea
              aria-label="Service notes"
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value || null })}
              rows={2}
              placeholder="Notes for the team (not shown on screen)"
              className="textarea text-xs"
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {selectedItem ? (
            <ItemInspector
              key={selectedItem.id}
              item={selectedItem}
              planThemeId={draft.themeId}
              onChange={(patch) => setItems(items.map((i) => (i.id === selectedItem.id ? { ...i, ...patch } : i)))}
            />
          ) : (
            <EmptyState title="Select an item" description="Choose an item to edit its settings and preview its slides." className="h-full" />
          )}
        </div>
      </div>

      <ImportPresentationDialog
        open={!!importing}
        itemType={importing === "sermon" ? "sermon" : "custom"}
        onClose={() => setImporting(false)}
        onAdd={(item, message, detail) => {
          setImporting(false);
          addItem(item);
          toast.success(message, detail);
        }}
        {...(importing === "sermon"
          ? {
              extraAction: {
                label: "Choose slides from the library…",
                onClick: () => {
                  setImporting(false);
                  setPicker("sermon");
                },
              },
            }
          : {})}
      />
      <ServiceDetailsDialog
        open={editingDetails}
        isTemplate={draft.isTemplate}
        value={{ title: draft.title, serviceDate: draft.serviceDate, serviceTime: draft.serviceTime, status: draft.status, themeId: draft.themeId }}
        onClose={() => setEditingDetails(false)}
        onSave={(details) => {
          update(details);
          setEditingDetails(false);
        }}
      />
      <SongPickerDialog open={picker === "song"} onClose={() => setPicker(null)} onPick={(s) => addItem({ itemType: "song", title: s.title, refId: s.id, settings: {}, notes: null })} />
      <ScripturePickerDialog
        open={picker === "scripture"}
        onClose={() => setPicker(null)}
        onPick={(p) => addItem({ itemType: "scripture", title: p.title, refId: null, settings: { translationId: p.translationId, references: p.references }, notes: null })}
      />
      <DeckPickerDialog
        open={picker === "announcement" || picker === "sermon" || picker === "custom"}
        category={picker === "announcement" ? "announcement" : picker === "sermon" ? "sermon" : null}
        title={picker === "announcement" ? "Choose announcement slides" : picker === "sermon" ? "Choose sermon slides" : "Choose slides"}
        onClose={() => setPicker(null)}
        {...(picker === "announcement"
          ? { extraAction: { label: "Plain text announcement instead", onClick: () => addItem({ itemType: "announcement", title: "Announcements", refId: null, settings: { text: "" }, notes: null }) } }
          : {})}
        onPick={(d) => addItem({ itemType: picker === "sermon" ? "sermon" : picker === "announcement" ? "announcement" : "custom", title: d.title, refId: d.id, settings: {}, notes: null })}
      />
      <MediaPickerDialog
        open={picker === "image" || picker === "video"}
        kind={picker === "video" ? "video" : "image"}
        title={picker === "video" ? "Choose a video" : "Choose an image"}
        onClose={() => setPicker(null)}
        onPick={(m) => addItem({ itemType: m.kind === "video" ? "video" : "image", title: m.title, refId: m.id, settings: { fit: m.kind === "video" ? "contain" : "cover", loop: false, muted: false }, notes: null })}
      />
    </div>
  );
}

function RowActions({ id, onMove, onDuplicate, onRemove }: { id: string; onMove: (id: string, dir: -1 | 1) => void; onDuplicate?: () => void; onRemove: () => void }) {
  return (
    <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      <IconButton size="sm" label="Move up" icon={<ArrowUp className="size-3.5" />} onClick={(e) => (e.stopPropagation(), onMove(id, -1))} />
      <IconButton size="sm" label="Move down" icon={<ArrowDown className="size-3.5" />} onClick={(e) => (e.stopPropagation(), onMove(id, 1))} />
      {onDuplicate && <IconButton size="sm" label="Duplicate" icon={<Copy className="size-3.5" />} onClick={(e) => (e.stopPropagation(), onDuplicate())} />}
      <IconButton size="sm" label="Remove" icon={<Trash2 className="size-3.5" />} onClick={(e) => (e.stopPropagation(), onRemove())} />
    </div>
  );
}

function SaveIndicator({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  const content = useMemo(() => {
    switch (state) {
      case "saved":
        return (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <Check className="size-3.5 text-success" /> Saved
          </span>
        );
      case "pending":
      case "saving":
        return (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <Loader2 className="size-3.5 animate-spin" /> Saving…
          </span>
        );
      case "error":
        return (
          <button type="button" onClick={onRetry} className="flex items-center gap-1 text-xs text-danger" title={error ?? ""}>
            <CircleAlert className="size-3.5" /> Not saved — {error} (retry)
          </button>
        );
    }
  }, [state, error, onRetry]);
  return <div className="max-w-80 truncate px-2">{content}</div>;
}
