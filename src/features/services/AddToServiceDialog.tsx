import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { create } from "zustand";
import type { ServiceItemInput } from "@/types/generated/ServiceItemInput";
import { api } from "@/services/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { formatServiceDate, nextSundayIso, todayIso } from "@/lib/format";
import { navigate } from "@/app/navigation";
import { useLive } from "@/services/presentation-engine/store";
import { cn } from "@/lib/cn";

interface Request {
  items: ServiceItemInput[];
  label: string;
}

const useAddToService = create<{ request: Request | null; set: (r: Request | null) => void }>((set) => ({
  request: null,
  set: (request) => set({ request }),
}));

/** Opens the "add to service" picker for one or more items. */
export function addToService(items: ServiceItemInput[], label: string) {
  useAddToService.getState().set({ items, label });
}

export async function appendToPlan(planId: string, items: ServiceItemInput[]) {
  const plan = await api.services.get(planId);
  const saved = await api.services.save({
    id: plan.id,
    title: plan.title,
    serviceDate: plan.serviceDate,
    serviceTime: plan.serviceTime,
    description: plan.description,
    notes: plan.notes,
    status: plan.status,
    isTemplate: plan.isTemplate,
    themeId: plan.themeId,
    items: [
      ...plan.items.map((i) => ({ id: i.id, itemType: i.itemType, title: i.title, refId: i.refId, settings: i.settings, notes: i.notes })),
      ...items,
    ],
  });
  // Keep the live view in step when this is the service being presented.
  if (useLive.getState().serviceId === planId) void useLive.getState().refresh();
  return saved;
}

export function AddToServiceHost() {
  const { request, set } = useAddToService();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const plans = useQuery({
    queryKey: ["services", "pick"],
    queryFn: async () => {
      const upcoming = await api.services.list({ text: null, status: null, templates: false, fromDate: todayIso(), toDate: null, sort: "dateAsc", limit: 10 });
      const recent = await api.services.list({ text: null, status: null, templates: false, fromDate: null, toDate: null, sort: "updated", limit: 10 });
      const seen = new Set(upcoming.map((p) => p.id));
      return [...upcoming, ...recent.filter((p) => !seen.has(p.id))];
    },
    enabled: !!request,
  });

  const add = async (planId: string | null) => {
    if (!request) return;
    setBusy(planId ?? "new");
    try {
      let id = planId;
      if (!id) {
        const plan = await api.services.save({
          id: null,
          title: "Sunday Service",
          serviceDate: nextSundayIso(),
          serviceTime: null,
          description: null,
          notes: null,
          status: "draft",
          isTemplate: false,
          themeId: null,
          items: [],
        });
        id = plan.id;
      }
      const saved = await appendToPlan(id, request.items);
      await qc.invalidateQueries({ queryKey: ["services"] });
      await qc.invalidateQueries({ queryKey: ["service", id] });
      toast.success(`Added ${request.label} to “${saved.title}”`);
      set(null);
      if (!planId) void navigate("services", { planId: id });
    } catch (e) {
      toast.error("Could not add to the service", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && set(null)} title={`Add ${request?.label ?? ""} to a service`} size="sm">
      <div className="space-y-1">
        {plans.data?.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!!busy}
            onClick={() => void add(p.id)}
            className={cn("flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-elevated", busy === p.id && "opacity-60")}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm">{p.title}</span>
              <span className="block text-xs text-subtle">{formatServiceDate(p.serviceDate, p.serviceTime)} · {p.itemCount} items</span>
            </span>
          </button>
        ))}
        {plans.data?.length === 0 && <p className="px-3 py-2 text-sm text-muted">No services yet.</p>}
        <Button className="mt-2 w-full" icon={<CalendarPlus className="size-4" />} loading={busy === "new"} onClick={() => void add(null)}>
          New service for next Sunday
        </Button>
      </div>
    </Dialog>
  );
}
