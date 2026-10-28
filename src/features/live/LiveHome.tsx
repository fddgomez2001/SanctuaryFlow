import { ArrowLeft, ArrowRight, CalendarPlus, Clock, ListOrdered } from "lucide-react";
import type { ServicePlanSummary } from "@/types/generated/ServicePlanSummary";
import { navigate } from "@/app/navigation";
import { Badge, LoadingBlock } from "@/components/ui/misc";
import { formatServiceDate, formatServiceTime } from "@/lib/format";
import { useLive } from "@/services/presentation-engine/store";
import { ServiceDateTile } from "@/features/services/ServiceDetailsDialog";
import { STATUS_TONE } from "@/features/services/ServicesPage";
import { useLiveServices } from "./LiveHeader";

const OUTFIT = '"Outfit Variable", "Inter Variable", sans-serif';

/** The Live page before a service is chosen: the saved services, ready to open. */
export function LiveHome({ onOpen, onBack }: { onOpen: () => void; onBack?: () => void }) {
  const live = useLive();
  const services = useLiveServices();
  const open = (id: string) => {
    void live.loadService(id);
    onOpen();
  };
  const card = (p: ServicePlanSummary) => (
    <button
      key={p.id}
      type="button"
      data-live-service={p.id}
      onClick={() => open(p.id)}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-panel p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <ServiceDateTile date={p.serviceDate} isTemplate={false} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{p.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-subtle">
          <span>{formatServiceDate(p.serviceDate)}</span>
          {p.serviceTime && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {formatServiceTime(p.serviceTime)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <ListOrdered className="size-3" /> {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
          </span>
        </span>
      </span>
      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
      <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
  const upcoming = services.data?.upcoming ?? [];
  const earlier = services.data?.earlier ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        {onBack && live.serviceTitle && (
          <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" /> Back to “{live.serviceTitle}”
          </button>
        )}
        <p className="text-[11px] font-semibold tracking-[0.25em] text-accent uppercase">Live Presentation</p>
        <h1 className="mt-1 text-3xl font-semibold" style={{ fontFamily: OUTFIT }}>
          Choose a service to present
        </h1>
        <span aria-hidden className="mt-2 block h-0.5 w-14 rounded-full bg-primary" />
        <p className="mt-3 text-sm text-muted">Open a service to see its items and slides, then press Go Live. To show a song or a Bible passage right away, use Present now below.</p>

        {services.isLoading && <LoadingBlock />}
        {upcoming.length > 0 && (
          <section className="mt-8" aria-label="Coming up">
            <h2 className="mb-3 text-sm font-semibold text-accent">Coming up</h2>
            <div className="grid gap-3 md:grid-cols-2">{upcoming.map(card)}</div>
          </section>
        )}
        {earlier.length > 0 && (
          <section className="mt-8" aria-label="Earlier services">
            <h2 className="mb-3 text-sm font-semibold text-accent">Earlier</h2>
            <div className="grid gap-3 md:grid-cols-2">{earlier.slice(0, 10).map(card)}</div>
          </section>
        )}
        <button
          type="button"
          onClick={() => void navigate("services")}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-5 text-sm text-muted transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-text"
        >
          <CalendarPlus className="size-5 text-primary" /> Plan a new service
        </button>
      </div>
    </div>
  );
}
