import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, LayoutTemplate } from "lucide-react";
import type { ServiceStatus } from "@/types/generated/ServiceStatus";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, TextField } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { useThemes } from "@/hooks/useThemes";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";
import { planToDocument } from "./model";

/** What is set about a service itself (rather than its items). */
export interface ServiceDetails {
  title: string;
  serviceDate: string | null;
  serviceTime: string | null;
  status: ServiceStatus;
  themeId: string | null;
}

export function ServiceDetailsDialog({
  open,
  value,
  isTemplate,
  onClose,
  onSave,
}: {
  open: boolean;
  value: ServiceDetails;
  isTemplate: boolean;
  onClose: () => void;
  onSave: (details: ServiceDetails) => void | Promise<void>;
}) {
  const themes = useThemes();
  const [d, setD] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setD(value);
    // Start from the service's details each time the dialog opens.
  }, [open]);
  const set = (patch: Partial<ServiceDetails>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...d, title: d.title.trim() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isTemplate ? "Template details" : "Service details"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!d.title.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField label="Title" value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        {!isTemplate && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Date" type="date" value={d.serviceDate ?? ""} onChange={(e) => set({ serviceDate: e.target.value || null })} />
              <TextField label="Time (optional)" type="time" value={d.serviceTime ?? ""} onChange={(e) => set({ serviceTime: e.target.value || null })} />
            </div>
            <Field label="Status">
              <Select value={d.status} onChange={(e) => set({ status: e.target.value as ServiceStatus })}>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          </>
        )}
        <Field label="Theme" hint="Used for items that have no theme of their own.">
          <Select value={d.themeId ?? ""} onChange={(e) => set({ themeId: e.target.value || null })}>
            <option value="">Default themes</option>
            {themes.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** Edits a saved service's details from the Service Planner list. */
export function PlanDetailsDialog({ planId, onClose }: { planId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.services.get>> | null>(null);
  useEffect(() => {
    setPlan(null);
    if (!planId) return;
    api.services.get(planId).then(setPlan, (e) => {
      toast.error("The service could not be opened", e);
      onClose();
    });
  }, [planId, onClose]);
  if (!plan) return null;
  return (
    <ServiceDetailsDialog
      open
      isTemplate={plan.isTemplate}
      value={{ title: plan.title, serviceDate: plan.serviceDate, serviceTime: plan.serviceTime, status: plan.status, themeId: plan.themeId }}
      onClose={onClose}
      onSave={async (details) => {
        try {
          const saved = await api.services.save({ ...planToDocument(plan), ...details });
          qc.setQueryData(["service", saved.id], saved);
          void qc.invalidateQueries({ queryKey: ["services"] });
          void qc.invalidateQueries({ queryKey: ["dashboard"] });
          if (useLive.getState().serviceId === saved.id) void useLive.getState().refresh();
          toast.success("Service details saved");
          onClose();
        } catch (e) {
          toast.error("The details could not be saved", e);
        }
      }}
    />
  );
}

/** A small calendar page: month over day, or a template / no-date mark. */
export function ServiceDateTile({ date, isTemplate, size = "md", className }: { date: string | null; isTemplate: boolean; size?: "sm" | "md"; className?: string }) {
  const [y, m, day] = (date ?? "").split("-").map(Number);
  const sm = size === "sm";
  if (isTemplate || !y || !m || !day) {
    return (
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-subtle", sm ? "size-10 [&>svg]:size-4" : "size-12 [&>svg]:size-5", className)}
      >
        {isTemplate ? <LayoutTemplate /> : <CalendarDays />}
      </span>
    );
  }
  const month = new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short" });
  return (
    <span aria-hidden className={cn("flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-panel text-center shadow-sm", sm ? "w-10" : "w-12", className)}>
      <span className={cn("bg-primary font-bold tracking-wider text-white uppercase", sm ? "text-[9px] leading-[14px]" : "py-0.5 text-[10px] leading-4")}>{month}</span>
      <span className={cn("font-semibold text-text", sm ? "text-base leading-6" : "py-0.5 text-lg leading-7")}>{day}</span>
    </span>
  );
}
