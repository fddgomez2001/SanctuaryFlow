import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SettingsMap } from "@/services/api";
import { toast } from "@/components/ui/Toast";

export const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: api.settings.all, staleTime: 60_000 });
}

/** Reads one setting with a typed fallback. */
export function setting<T>(settings: SettingsMap | undefined, key: string, fallback: T): T {
  const v = settings?.[key];
  if (v === undefined || v === null) return fallback;
  if (typeof fallback === "number") return (typeof v === "number" ? v : fallback) as T;
  if (typeof fallback === "boolean") return (typeof v === "boolean" ? v : fallback) as T;
  if (typeof fallback === "string") return (typeof v === "string" ? v : fallback) as T;
  return v as T;
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: SettingsMap) => api.settings.setMany(values),
    onMutate: async (values) => {
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = qc.getQueryData<SettingsMap>(SETTINGS_KEY);
      qc.setQueryData<SettingsMap>(SETTINGS_KEY, { ...(previous ?? {}), ...values });
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(SETTINGS_KEY, ctx.previous);
      toast.error("The setting could not be saved", e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}
