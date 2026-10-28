import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { CalendarDays, Clock, Copy, FileDown, FileUp, LayoutTemplate, ListOrdered, MonitorPlay, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ServicePlanQuery } from "@/types/generated/ServicePlanQuery";
import type { ServicePlanSummary } from "@/types/generated/ServicePlanSummary";
import { api } from "@/services/api";
import { navigate, useNav } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog, confirm } from "@/components/ui/Dialog";
import { Field, Input, Select, TextField } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, LoadingBlock, PageHeader } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { formatServiceDate, formatServiceTime, nextSundayIso, todayIso } from "@/lib/format";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";
import { ServiceEditor } from "./ServiceEditor";
import { PlanDetailsDialog, ServiceDateTile } from "./ServiceDetailsDialog";

type Tab = "upcoming" | "past" | "templates" | "all";

export function ServicesPage() {
  const planId = useNav((s) => s.params.planId);
  // Opened from the Live page ("Edit service"): Back returns there.
  const returnTo = useNav((s) => s.params.returnTo);
  return planId ? <ServiceEditor key={planId} planId={planId} returnTo={returnTo === "live" ? "live" : undefined} /> : <ServiceList />;
}

export const STATUS_TONE = { draft: "neutral", ready: "success", completed: "primary", archived: "neutral" } as const;

export async function exportService(id: string, title: string) {
  const path = await saveDialog({
    title: "Export service",
    defaultPath: `${title.replace(/[\\/:*?"<>|]/g, "")}.sfservice.json`,
    filters: [{ name: "SanctuaryFlow service", extensions: ["json"] }],
  });
  if (!path) return;
  try {
    await api.services.exportTo(id, path);
    toast.success("Service exported", path);
  } catch (e) {
    toast.error("The service could not be exported", e);
  }
}

export async function importService(): Promise<string | null> {
  const path = await openDialog({ title: "Import a service", filters: [{ name: "SanctuaryFlow service", extensions: ["json"] }] });
  if (typeof path !== "string") return null;
  try {
    const r = await api.services.importFrom(path);
    toast.success(
      "Service imported",
      `${r.songsAdded} new song(s), ${r.songsAlreadyPresent} already in the library, ${r.decksAdded} slide deck(s).${r.missingMedia.length ? ` Missing media: ${r.missingMedia.join(", ")}.` : ""}`,
    );
    return r.planId;
  } catch (e) {
    toast.error("The service could not be imported", e);
    return null;
  }
}

function ServiceList() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const closeDetails = useCallback(() => setEditing(null), []);
  const loadService = useLive((s) => s.loadService);
  const today = todayIso();
  const query: ServicePlanQuery = {
    text: text.trim() || null,
    status: null,
    templates: tab === "templates",
    fromDate: tab === "upcoming" ? today : null,
    toDate: tab === "past" ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : null,
    sort: tab === "upcoming" ? "dateAsc" : "dateDesc",
    limit: 500,
  };
  const plans = useQuery({ queryKey: ["services", query], queryFn: () => api.services.list(query), placeholderData: (p) => p });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["services"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const duplicate = async (p: ServicePlanSummary, asTemplate: boolean) => {
    try {
      const copy = await api.services.duplicate(p.id, { title: null, asTemplate, serviceDate: asTemplate ? null : nextSundayIso() });
      invalidate();
      toast.success(asTemplate ? "Saved as a template" : "Service duplicated for next Sunday");
      if (!asTemplate) void navigate("services", { planId: copy.id });
    } catch (e) {
      toast.error("Could not copy the service", e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Service Planner"
        description="Plan the order of worship. Changes are saved automatically."
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={async () => {
              const id = await importService();
              if (id) {
                invalidate();
                void navigate("services", { planId: id });
              }
            }}>
              Import
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New service
            </Button>
          </>
        }
      />
      <div className="flex items-center gap-3 border-b border-border px-6 py-2.5">
        <div className="flex gap-1" role="tablist">
          {(["upcoming", "past", "templates", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("rounded-md px-3 py-1.5 text-sm capitalize", tab === t ? "bg-elevated text-text" : "text-muted hover:text-text")}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search services" className="pl-8" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {plans.isLoading && <LoadingBlock />}
        {plans.isError && <ErrorNotice title="Services could not be loaded" message={String(plans.error)} />}
        {plans.data?.length === 0 && (
          <EmptyState
            icon={tab === "templates" ? <LayoutTemplate /> : <CalendarDays />}
            title={tab === "templates" ? "No templates yet" : text ? "No services match" : "No services here yet"}
            description={tab === "templates" ? "Save a service as a template to reuse its order every week." : "Create a service and add songs, Scripture and announcements."}
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New service</Button>}
          />
        )}
        <div className="mx-auto max-w-5xl space-y-2">
          {plans.data?.map((p) => (
            <div key={p.id} className="panel group flex items-center gap-4 px-3 py-2.5 transition-shadow hover:border-border-strong hover:shadow-md">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => void navigate("services", { planId: p.id })}>
                <ServiceDateTile date={p.serviceDate} isTemplate={p.isTemplate} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-subtle">
                    <span>{p.isTemplate ? "Template" : formatServiceDate(p.serviceDate)}</span>
                    {p.serviceTime && !p.isTemplate && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {formatServiceTime(p.serviceTime)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <ListOrdered className="size-3" /> {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
              </button>
              {!p.isTemplate && <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>}
              <div className="flex items-center gap-1">
                {!p.isTemplate && (
                  <Button size="sm" variant="outline" icon={<MonitorPlay className="size-3.5" />} onClick={() => void loadService(p.id).then(() => navigate("live"))}>
                    Present
                  </Button>
                )}
                <IconButton size="sm" label="Edit details (title, date, time)" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p.id)} />
                <IconButton size="sm" label={p.isTemplate ? "New service from template" : "Duplicate for next Sunday"} icon={<Copy className="size-3.5" />} onClick={() => void duplicate(p, false)} />
                {!p.isTemplate && <IconButton size="sm" label="Save as template" icon={<LayoutTemplate className="size-3.5" />} onClick={() => void duplicate(p, true)} />}
                <IconButton size="sm" label="Export" icon={<FileDown className="size-3.5" />} onClick={() => void exportService(p.id, p.title)} />
                <IconButton
                  size="sm"
                  label="Delete"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete “${p.title}”?`, message: "The service plan will be removed. Songs and slides in it are not deleted.", confirmLabel: "Delete", danger: true }))) return;
                    try {
                      await api.services.remove(p.id);
                      invalidate();
                      toast.success("Service deleted");
                    } catch (e) {
                      toast.error("Could not delete the service", e);
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <PlanDetailsDialog planId={editing} onClose={closeDetails} />
      <NewServiceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          invalidate();
          setCreating(false);
          void navigate("services", { planId: id });
        }}
      />
    </div>
  );
}

function NewServiceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("Sunday Service");
  const [date, setDate] = useState(nextSundayIso());
  const [time, setTime] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const templates = useQuery({
    queryKey: ["services", "templates-pick"],
    queryFn: () => api.services.list({ text: null, status: null, templates: true, fromDate: null, toDate: null, sort: "updated", limit: 50 }),
    enabled: open,
  });
  const recent = useQuery({
    queryKey: ["services", "recent-pick"],
    queryFn: () => api.services.list({ text: null, status: null, templates: false, fromDate: null, toDate: null, sort: "dateDesc", limit: 10 }),
    enabled: open,
  });
  const create = async () => {
    setBusy(true);
    try {
      let id: string;
      if (source) {
        const copy = await api.services.duplicate(source, { title, asTemplate: false, serviceDate: date || null });
        id = copy.id;
        if (time) await api.services.save({ ...copy, serviceTime: time, items: copy.items.map((i) => ({ ...i })) });
      } else {
        const plan = await api.services.save({ id: null, title, serviceDate: date || null, serviceTime: time || null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null, items: [] });
        id = plan.id;
      }
      onCreated(id);
    } catch (e) {
      toast.error("The service could not be created", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New service"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <Field label="Start from">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">An empty service</option>
            {templates.data && templates.data.length > 0 && (
              <optgroup label="Templates">
                {templates.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            )}
            {recent.data && recent.data.length > 0 && (
              <optgroup label="Copy a previous service">
                {recent.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.serviceDate ?? "no date"})
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
