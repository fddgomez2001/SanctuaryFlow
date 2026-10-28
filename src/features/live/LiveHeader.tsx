import { useQuery } from "@tanstack/react-query";
import { DropdownMenu as M } from "radix-ui";
import { CalendarPlus, ChevronDown, CircleAlert, LayoutGrid, Maximize, Pencil, Radio, RefreshCw } from "lucide-react";
import type { ServicePlanSummary } from "@/types/generated/ServicePlanSummary";
import { api } from "@/services/api";
import { navigate } from "@/app/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/Toast";
import { formatServiceDate, formatServiceTime, todayIso } from "@/lib/format";
import { useLive } from "@/services/presentation-engine/store";
import { ServiceDateTile } from "@/features/services/ServiceDetailsDialog";
import { cn } from "@/lib/cn";

/** Services to offer: upcoming first (soonest first), then the most recent ones. */
export function useLiveServices() {
  return useQuery({
    queryKey: ["services", "live-pick"],
    queryFn: () => api.services.list({ text: null, status: null, templates: false, fromDate: null, toDate: null, sort: "dateDesc", limit: 60 }),
    select: (plans) => {
      const today = todayIso();
      const upcoming = plans.filter((p) => p.serviceDate && p.serviceDate >= today).reverse();
      const earlier = plans.filter((p) => !p.serviceDate || p.serviceDate < today);
      return { upcoming, earlier };
    },
  });
}

const when = (p: ServicePlanSummary) => [formatServiceDate(p.serviceDate), p.serviceTime ? formatServiceTime(p.serviceTime) : null].filter(Boolean).join(" · ");

/** The Live page's top bar: which service is open, and Go Live. */
export function LiveHeader({ onBrowse }: { onBrowse: () => void }) {
  const live = useLive();
  const { projector, displays } = live;
  const secondaryAvailable = displays.some((d) => !d.isPrimary);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2.5">
      <ServiceSwitcher onBrowse={onBrowse} />
      {live.serviceId && (
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => void navigate("services", { planId: live.serviceId!, returnTo: "live" })}>
          Edit service
        </Button>
      )}
      <IconButton size="sm" label="Reload service" icon={<RefreshCw className={cn("size-4", live.loading && "animate-spin")} />} onClick={() => void live.refresh()} />
      {projector.waitingForDisplay && (
        <Badge tone="warning">
          <CircleAlert className="size-3" /> Output display disconnected — reconnect it to resume
        </Badge>
      )}
      {live.loadError && <Badge tone="danger">{live.loadError}</Badge>}
      <div className="ml-auto flex items-center gap-2">
        {projector.open && projector.mode === "window" && secondaryAvailable && (
          <Button size="sm" variant="secondary" icon={<Maximize className="size-3.5" />} onClick={() => void live.openProjector(projector.displayId, "fullscreen")}>
            Full screen
          </Button>
        )}
        <GoLiveButton />
      </div>
    </header>
  );
}

/** Opens the output on the second display (Settings → Presentation chooses another); glows gold while live. */
function GoLiveButton() {
  const live = useLive();
  const open = live.projector.open;
  const secondaryAvailable = live.displays.some((d) => !d.isPrimary);
  const start = async () => {
    try {
      await live.openProjector();
      if (!secondaryAvailable) toast.info("Only one display is connected", "The output opened in a window on this screen. Connect a projector to present full screen.");
    } catch (e) {
      toast.error("The output could not be opened", e);
    }
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void start()}
        title="Show the output on the second display"
        className="inline-flex h-10 items-center gap-2 rounded-full bg-[linear-gradient(135deg,#d9b25c,#b0842a_55%,#8a6417)] px-5 text-sm font-semibold tracking-wide text-white shadow-[0_6px_18px_-6px_rgb(176_132_42/0.75)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Radio className="size-4" /> Go Live
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void live.closeProjector()}
      aria-label="Stop output"
      title="You are live. Click to stop the output."
      className="sf-live-gold group inline-flex h-10 items-center gap-2.5 rounded-full px-5 text-sm font-semibold tracking-wide text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
        <span className="relative inline-flex size-2.5 rounded-full bg-white" />
      </span>
      <span className="group-hover:hidden">Live</span>
      <span className="hidden group-hover:inline">Stop live</span>
    </button>
  );
}

/** The open service, with the others a click away. */
function ServiceSwitcher({ onBrowse }: { onBrowse: () => void }) {
  const live = useLive();
  const services = useLiveServices();
  const plans = [...(services.data?.upcoming ?? []), ...(services.data?.earlier ?? [])];
  const current = plans.find((p) => p.id === live.serviceId);
  const item = (p: ServicePlanSummary) => (
    <M.Item
      key={p.id}
      data-plan-id={p.id}
      onSelect={() => void live.loadService(p.id)}
      className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover", p.id === live.serviceId && "bg-primary/10")}
    >
      <ServiceDateTile date={p.serviceDate} isTemplate={false} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{p.title}</span>
        <span className="block truncate text-xs text-subtle">
          {when(p)} · {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
        </span>
      </span>
    </M.Item>
  );
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          aria-label={current ? `Service: ${current.title}` : "Choose a service"}
          className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-bg py-1 pr-3 pl-1 text-left transition hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <ServiceDateTile date={current?.serviceDate ?? null} isTemplate={false} size="sm" />
          <span className="min-w-0">
            <span className="block max-w-72 truncate text-sm font-semibold">{current?.title ?? live.serviceTitle ?? "Choose a service"}</span>
            <span className="block max-w-72 truncate text-xs text-subtle">{current ? when(current) : "Your services and Present now"}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-subtle transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content align="start" sideOffset={6} className="z-50 max-h-[70vh] w-96 overflow-y-auto rounded-xl border border-border bg-panel p-1.5 shadow-2xl">
          {(services.data?.upcoming.length ?? 0) > 0 && (
            <>
              <M.Label className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Coming up</M.Label>
              {services.data!.upcoming.map(item)}
            </>
          )}
          {(services.data?.earlier.length ?? 0) > 0 && (
            <>
              <M.Label className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Earlier</M.Label>
              {services.data!.earlier.slice(0, 12).map(item)}
            </>
          )}
          <M.Separator className="my-1.5 h-px bg-border" />
          <M.Item onSelect={onBrowse} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover">
            <LayoutGrid className="size-4 text-primary" /> All services
          </M.Item>
          <M.Item onSelect={() => void navigate("services")} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover">
            <CalendarPlus className="size-4 text-primary" /> Plan a new service
          </M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
