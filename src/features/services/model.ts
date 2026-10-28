import type { ServicePlan } from "@/types/generated/ServicePlan";
import type { ServicePlanDocument } from "@/types/generated/ServicePlanDocument";

export function planToDocument(plan: ServicePlan): ServicePlanDocument {
  return {
    id: plan.id,
    title: plan.title,
    serviceDate: plan.serviceDate,
    serviceTime: plan.serviceTime,
    description: plan.description,
    notes: plan.notes,
    status: plan.status,
    isTemplate: plan.isTemplate,
    themeId: plan.themeId,
    items: plan.items.map((i) => ({ id: i.id, itemType: i.itemType, title: i.title, refId: i.refId, settings: i.settings, notes: i.notes })),
  };
}
